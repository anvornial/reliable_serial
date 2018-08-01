function ReliableSerial(serialport_addr, serialport_param, cb){
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

    // symbol list
    var symbol = {
        PING : 'p'.charCodeAt(),
        PONG : 'P'.charCodeAt(),
        PLAIN : 'a'.charCodeAt(),
        RELIABLE : 'b'.charCodeAt(),
        RELIABLE_ACK : 'B'.charCodeAt(),
    }

    // Protocol state
    var state = {
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
        on_data_cb : function(){return false},
        on_ping_cb : function(){return false}
    }
    
    // receive data from serial
    port.on('data', 
        function(data){ 
            state.bytes_receive = state.bytes_receive + data.length
            // fill buffer for slip decoding and frame check
            slip_decoder.decode(data)
        }
    )

    function create_pong_waiter(cb){
        if(state.waiting_pong == null){
            state.waiting_pong = {}
            state.waiting_pong.cb = cb
            state.waiting_pong.timestamp = Date.now()
            state.waiting_pong.timeout_handler = setTimeout(
                function timeout_happen() {
                    if(state.waiting_pong.cb('timeout')){
                        // resend new ping packet
                        create_pong_waiter(cb)
                    }
                    state.waiting_pong = null
                    state.packets_loss++
                }, state.ping_timeout
            )
            // send ping packet
            frame_send(packet_ping_encode())
            return true
        } else { // still waiting for pong packet
            return false
        }
    }

    function check_pong_waiter(){
        if(state.waiting_pong != null){
            clearTimeout(state.waiting_pong.timeout_handler)
            state.waiting_pong.cb('')
            state.waiting_pong = null
        } else {
            state.packets_drop++
        }
    }

    function create_ack_waiter(buf, cb, timeout, retry, id) {
        retry = typeof retry  !== 'undefined' ? retry : state.common_retry
        timeout = typeof timeout  !== 'undefined' ? timeout : state.common_timeout
        cb = typeof cb !== 'undefined' ? cb : function(){ return false }
        id = typeof id !== 'undefined' ? id : state.current_reliable_id + 1
        
        if(id > 255) {
            id = 0;
        }
            
        if(!state.waiting_ack.hasOwnProperty(id)) {
            state.waiting_ack[id] = {}
            state.waiting_ack[id].cb = cb
            state.waiting_ack[id].timestamp = Date.now()
            state.waiting_ack[id].timeout_handler = setTimeout(
                function realibility_timeout() {
                    cb_retval = cb(id, 'timeout')
                    delete state.waiting_ack[id]

                    retry--
                    if(retry <= 0){
                        if(cb_retval){
                            // forcefully resend packet, if callback return true
                            create_ack_waiter(buf,cb,timeout,retry,id)
                        }
                    } else {
                        create_ack_waiter(buf,cb,timeout,retry,id)
                    }
                    state.packets_loss++
                }, 
                timeout
            ) 
            // send frame
            frame_send(packet_reliable_encode(buf,id))
            state.current_reliable_id = id
            return true
        } else { // id is all used
            return false
        }

    }

    function check_ack_waiter(id){
        if(state.waiting_ack.hasOwnProperty(id)){
            clearTimeout(state.waiting_ack[id].timeout_handler)
            state.waiting_ack[id].cb(id)
            delete state.waiting_ack[id]
        } else {
            state.packets_drop++
        }
    }

    function packet_plain_encode(buf){
        var header_buf = Buffer.alloc(1)
        header_buf[0] = symbol.PLAIN
        return Buffer.concat([header_buf,buf])
    }

    function packet_plain_decode(buf){
        return buf.slice(1)
    }

    function packet_pong_decode(buf){
        check_pong_waiter(parseInt(buf[1]))
    }

    function packet_ping_decode(buf){
        // send pong back
        frame_send(packet_pong_encode())
        state.on_ping_cb()
    }

    function packet_reliable_decode(buf){
        var buf2 = buf.slice(2,buf.length)
        // send ack
        var id = parseInt(buf[1])

        // do not take packet with same id from previous one, just return ack
        // maybe the sender failed to receive our last ack
        if(state.last_receive_id == id){
            frame_send(packet_reliable_ack_encode(state.last_receive_id))
            return null
        } else {
            state.last_receive_id = id
            return buf2
        }   
    }

    function packet_reliable_ack_decode(buf){
        check_ack_waiter(parseInt(buf[1]))
    }

    function packet_ping_encode(){
        var buf = Buffer.alloc(1)
        buf[0] = symbol.PING
        return buf
    }

    function packet_pong_encode(){
        var buf = Buffer.alloc(1)
        buf[0] = symbol.PONG
        return buf
    }

    function packet_reliable_encode(buf, id) {
        var buf_header = new Buffer(2)
        buf_header[0] = symbol.RELIABLE
        buf_header[1] = parseInt(id)
        var buf2 = Buffer.concat([buf_header,buf])
        return buf2
    }

    function packet_reliable_ack_encode(id){
        var buf = new Buffer(2)
        buf[0] = symbol.RELIABLE_ACK
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

    function packet_check(buf){
        if(buf[0] == symbol.PLAIN) {
            var buf_decode = packet_plain_decode(buf)
            state.on_data_cb(buf)
            return true
        }

        if(buf[0] == symbol.RELIABLE) {
            var buf_decode = packet_reliable_decode(buf)
            if(buf_decode != null)
                state.on_data_cb(buf_decode)
            return true
        }

        if(buf[0] == symbol.RELIABLE_ACK) {
            packet_reliable_ack_decode(buf)
            return true
        } 

        if(buf[0] == symbol.PING) {
            packet_ping_decode(buf)
            return true
        }

        if(buf[0] == symbol.PONG) {
            packet_pong_decode(buf)
            return true
        }

        return false
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
            // empty frame
        }

        if(crc_valid) {
            // slice out crc
            var buf = new Buffer(data.slice(0,data.length-num_crc))
            
            if(packet_check(buf)){
                state.packets_receive++
            } else {
                state.packets_drop++    
            }

        } else {
            state.packets_drop++
        }
    }

    function frame_send(buf,cb){
        var bufsend = slip.encode(frame_construct(buf))

        if(typeof cb == 'function')
            port.write(bufsend,cb)
        else
            port.write(bufsend)

        state.bytes_send = state.bytes_send + bufsend.length
        state.packets_send++
    }

    // All Public Function is here

    function send(data, cb){
        frame_send(packet_plain_encode(Buffer.from(data)), cb)
    }

    function send_reliable(data,cb){
        create_ack_waiter(Buffer.from(data), cb)
    }

    function ping(cb){
        create_pong_waiter(cb)
    }

    function on_data(cb){
        state.on_data_cb = cb
    }

    function on_ping(cb){
        state.on_ping_cb = cb
    }

    this.send = send
    this.send_reliable = send_reliable
    this.ping = ping
    this.on_data = on_data
    this.on_ping = on_ping

    this.get_state = function(){
        return state
    }
}

// export the class
module.exports = ReliableSerial