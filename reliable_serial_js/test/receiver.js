var ReliableSerial = require('../reliableserial')

var rserial = new ReliableSerial('/dev/ttyUSB1', { baudRate : 57600 }, function(e) {
    rserial.on_ping(function(e){
        console.log()
        console.log("got ping")
    })

    rserial.on_data(function(buf){
        console.log()
        console.log('get data')
        console.log(buf.toString('utf8'))
    })
})

console.log("start reliable serial receiver test")
//var control = new ControlModel()

