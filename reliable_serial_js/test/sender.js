var ReliableSerial = require('../reliableserial')

var rserial = new ReliableSerial('/dev/ttyUSB1', { baudRate : 57600 }, function(e) {   
    setInterval(function(){
        console.log('send ping')
        rserial.ping(function(e) {
            if(e == 'timeout'){
                console.log('ping timeout')
            }
        })
    }, 1500)

    setInterval(function(){
        console.log('send reliable data')
        rserial.send_reliable(
            'hello world !',
            function(id, e){
                console.log('data send status id' + id)
                console.log(e)
            }
        )
    }, 500)

})

console.log("Start reliable serial sender test")

