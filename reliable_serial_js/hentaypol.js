function Hentaypol(serialport_addr, serialport_param, cb){
    if(!serialport_addr)
        serialport_addr = '/dev/ttyUSB0'
    
    if(!serialport_param)
        serialport_param = { baudRate: 57600 }
    
    var SerialPort = require('serialport');
    var port = new SerialPort(
        serialport_addr, 
        serialport_param, 
        function (err) {
            if(cb)
                cb(err)
        }
    )

    var crc = require('crc');
    var slip = require('slip')

    var slip_decoder = new slip.Decoder({
        onMessage: frame_check,
        maxMessageSize: 240,
        bufferSize: 61
    })

    // HENTAYPOL symbol
    var hentaypol_symbol = {
        PING : 'p'.charCodeAt(),
        PONG : 'P'.charCodeAt(),
        INDEX_BYTE : 'x'.charCodeAt(),
        ARRAY_BYTE : 'z'.charCodeAt(),
        RELIABLE : 'b'.charCodeAt(),
        RELIABLE_ACK : 'B'.charCodeAt()
    }

    // Protocol state
    var hentaypol_state = {
        waiting_pong : null, // store ping-pong session
        waiting_ack : {}, // store realibility session
        common_timeout : 100,
        common_retry : 3,
        ping_timeout : 500,
        current_reliable_id : 0, // store current id for reliable ack, increase with each packet send
        last_receive_id : 0, // last sucessfully receive realibility packet id
        packets_drop : 0, // drops because invalid crc or invalid ack
        packets_loss : 0, // lost because of timeout
        packets_send : 0,  
        packets_receive : 0, 
        bytes_send : 0, // raw byte (including slip framing)
        bytes_receive : 0, // raw byte (including slip framing)
        on_data_cb : 0,
        on_ping_cb : 0
    }
    
    // receive data from serial
    port.on('data', 
        function(data){ 
            hentaypol_state.bytes_receive = hentaypol_state.bytes_receive + data.length
            // fill buffer for slip decoding and frame check
            slip_decoder.decode(data)
        }
    )

    function create_pong_waiter(cb){
        if(hentaypol_state.waiting_pong == null){
            hentaypol_state.waiting_pong = {}
            hentaypol_state.waiting_pong.cb = cb
            hentaypol_state.waiting_pong.timestamp = Date.now()
            hentaypol_state.waiting_pong.timeout_handler = setTimeout(
                function timeout_happen() {
                    if(hentaypol_state.waiting_pong.cb('timeout')){
                        // resend new ping packet
                        create_pong_waiter(cb)
                    }
                    hentaypol_state.waiting_pong = null
                    hentaypol_state.packets_loss++
                }, hentaypol_state.ping_timeout
            )
            // send ping packet
            frame_send(packet_ping_encode())
            return true
        } else {
            return false
        }
    }

    function check_pong_waiter(){
        if(hentaypol_state.waiting_pong != null){
            clearTimeout(hentaypol_state.waiting_pong.timeout_handler)
            hentaypol_state.waiting_pong.cb()
            hentaypol_state.waiting_pong = null
        } else {
            hentaypol_state.packets_drop++
        }
    }

    function create_ack_waiter(buf, cb, timeout, retry, id) {
        retry = typeof retry  !== 'undefined' ? retry : hentaypol_state.common_retry
        timeout = typeof timeout  !== 'undefined' ? timeout : hentaypol_state.common_timeout
        cb = typeof cb !== 'undefined' ? cb : function(){ return false }
        id = typeof id !== 'undefined' ? id : hentaypol_state.current_reliable_id + 1
        
        if(id > 255) {
            id = 0;
        }
            
        if(!hentaypol_state.waiting_ack.hasOwnProperty(id)) {
            hentaypol_state.waiting_ack[id] = {}
            hentaypol_state.waiting_ack[id].cb = cb
            hentaypol_state.waiting_ack[id].timestamp = Date.now()
            hentaypol_state.waiting_ack[id].timeout_handler = setTimeout(
                function realibility_timeout() {
                    cb_retval = cb(id, 'timeout')
                    delete hentaypol_state.waiting_ack[id]

                    retry--
                    if(retry <= 0){
                        if(cb_retval){
                            // forcefully resend packet, if callback return true
                            create_ack_waiter(buf,cb,timeout,retry,id)
                        }
                    } else {
                        create_ack_waiter(buf,cb,timeout,retry,id)
                    }
                    hentaypol_state.packets_loss++
                }, 
                timeout
            ) 
            // send frame
            frame_send(packet_reliable_encode(buf,id))
            hentaypol_state.current_reliable_id = id
            return true
        } else {
            return false
        }

    }

    function check_ack_waiter(id){
        if(hentaypol_state.waiting_ack.hasOwnProperty(id)){
            clearTimeout(hentaypol_state.waiting_ack[id].timeout_handler)
            hentaypol_state.waiting_ack[id].cb(id)
            delete hentaypol_state.waiting_ack[id]
        } else {
            hentaypol_state.packets_drop++
        }
    }

    function packet_pong_decode(buf){
        check_pong_waiter(parseInt(buf[1]))
    }

    function packet_ping_decode(buf){
        // send pong back
        frame_send(packet_pong_encode())
        hentaypol_state.on_ping_cb()
    }

    function packet_byte_array_decode(buf){
        var data = {}
        data.type = 'byte_array'
        data.payload = Array.prototype.slice.call(buf, 0)
        data.payload_raw = buf.slice(1)
        hentaypol_state.on_data_cb(data)
    }

    function packet_byte_index_decode(buf){
        var data = {}
        data.type = 'byte_index'
        data.payload = {}
        data.payload_raw = buf
        for(var i = 1;i<buf.length;i=i+2) {
            data.payload[parseInt(buf[i])] = buf[i+1]
        }
        hentaypol_state.on_data_cb(data)
    }

    function packet_reliable_decode(buf){
        var buf2 = buf.slice(2,buf.length)
        // send ack
        var id = parseInt(buf[1])
        if(hentaypol_state.last_receive_id == id){
            frame_send(packet_reliable_ack_encode(hentaypol_state.last_receive_id))
            return null
        } else {
            hentaypol_state.last_receive_id = id
            return buf2
        }
        
    }

    function packet_reliable_ack_decode(buf){
        check_ack_waiter(parseInt(buf[1]))
    }

    function packet_ping_encode(){
        var buf = Buffer.alloc(1)
        buf[0] = hentaypol_symbol.PING
        return buf
    }

    function packet_pong_encode(){
        var buf = Buffer.alloc(1)
        buf[0] = hentaypol_symbol.PONG
        return buf
    }

    function packet_byte_array_encode(payload) {
        var header_buf = Buffer.alloc(1)
        header_buf[0] = hentaypol_symbol.ARRAY_BYTE
        var data_buf = new Buffer(payload)
        
        return Buffer.concat([header_buf,data_buf])
    }

    function packet_byte_index_encode(payload){
        var buf = new Buffer((Object.keys(payload)).length * 2 + 1)
        buf[0] = hentaypol_symbol.INDEX_BYTE
        var j = 1
        for(var i in payload){
            buf[j] = parseInt(i)            
            buf[j+1] = parseInt(payload[i])
            j=j+2
        }
        return buf
    }

    function packet_reliable_encode(buf, id) {
        var buf_header = new Buffer(2)
        buf_header[0] = hentaypol_symbol.RELIABLE
        buf_header[1] = parseInt(id)
        var buf2 = Buffer.concat([buf_header,buf])
        return buf2
    }

    function packet_reliable_ack_encode(id){
        var buf = new Buffer(2)
        buf[0] = hentaypol_symbol.RELIABLE_ACK
        buf[1] = parseInt(id)
        return buf
    }

    function frame_construct(buf){
        if(buf.length) {
            var num_crc = Math.ceil(buf.length / 60)
            var crcs = new Buffer(num_crc)
            for(var i = 0;i<num_crc;i++){
                var blockstart = i * 60
                var blockend = ((i+1) * 60) + 1 < buf.length-1 ? ((i+1) * 60) + 1 : buf.length-1
                crcs[i] = crc.crc81wire(buf.slice(blockstart, blockend+1))
            }
            return Buffer.concat([buf, crcs])
        }
    }

    // called by slip decoder
    function frame_check(data) {
        var num_crc = Math.ceil(data.length / 60)
        var crcs = []
        var crcs_calculated = []
        var crc_valid = true
        if(num_crc){
            for(var i = 0;i<num_crc;i++){
                crcs[i] = data[data.length - (num_crc-i)]
                var blockstart = i * 60
                var blockend = ((i+1) * 60) - 1 < data.length-(num_crc+1) ? ((i+1) * 60) - 1 : data.length-(num_crc+1)
                if(blockstart > blockend){
                    // data on furthermost block is empty, but crc_num told the opposite
                    crc_valid = false
                    continue
                }
                crcs_calculated[i] = crc.crc81wire(data.slice(blockstart,blockend + 1))
                crc_valid = crc_valid & (crcs[i] == crcs_calculated[i])
            }
        } else {
            // empty packet
        }

        if(crc_valid) {
            hentaypol_state.packets_receive++
            // slice out crc, and convert from buffer
            var buf = new Buffer(data.slice(0,data.length-num_crc))
            switch(buf[0]){
                case hentaypol_symbol.RELIABLE :
                    buf = packet_reliable_decode(buf)
                    if(buf == null) return
                    break
                case hentaypol_symbol.RELIABLE_ACK :
                    packet_reliable_ack_decode(buf)
                    return
            }

            // decode basic form
            switch(buf[0]) {
                case hentaypol_symbol.PING :
                    packet_ping_decode(buf)
                    break
                case hentaypol_symbol.PONG :
                    packet_pong_decode(buf)
                    break
                case hentaypol_symbol.INDEX_BYTE :
                    packet_byte_index_decode(buf)
                    break
                case hentaypol_symbol.ARRAY_BYTE :
                    packet_byte_array_decode(buf)
                    break
                default :
                    hentaypol_state.packets_drop++
            }
        } else {
            hentaypol_state.packets_drop++
        }
    }

    function frame_send(buf){
        var bufsend = slip.encode(frame_construct(buf))
        port.write(bufsend)
        hentaypol_state.bytes_send = hentaypol_state.bytes_send + bufsend.length
        hentaypol_state.packets_send++
    }

    // All Public Function

    /*
    example data object

    data = {
        reliable : 1,
        type : 'array_byte'
        payload : [0,2,4,5,6,21]
    }

    data = {
        reliable : 0,
        type : 'index_byte'
        payload : 
            {
                '1': 2,
                '2' : 32,
                '30' : 54
            }
    }

    data = {
        type : 'ping'
    }

    */

    function send(data, cb){
        var buf
        if(data.type == 'index_byte'){
            buf = packet_byte_index_encode(data.payload)
        } else if(data.type == 'array_byte'){
            buf = packet_byte_array_encode(data.payload)
        } else if(data.type == 'ping'){
            // send ping plainly as is
            create_pong_waiter(cb)
            return
        }

        if(data.hasOwnProperty('reliable')) {
            if(data.reliable){
                create_ack_waiter(buf,cb)
                return
            }
        } 
        frame_send(buf)
    }

    function ping(cb){
        send(
            {
                type : 'ping'
            }, 
            cb)
    }

    function on_data(cb){
        hentaypol_state.on_data_cb = cb
    }

    function on_ping(cb){
        hentaypol_state.on_ping_cb = cb
    }

    this.send = send
    this.ping = ping
    this.on_data = on_data
    this.on_ping = on_ping

    this.get_state = function(){
        return hentaypol_state
    }
}

// export the class
module.exports = Hentaypol