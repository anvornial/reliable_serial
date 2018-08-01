var Hentaypol = require('./hentaypol')
var ControlModel = require('./controlmodel')

var hentay = new Hentaypol('/dev/ttyUSB1', { baudRate : 57600 }, function(err) {
    hentay.on_ping(function(e){
        //console.log('got ping with id')
        //console.log(hentay.get_state())
    })

    hentay.on_data(function(data){
        //console.log('get data')
        console.log(data.payload_raw.toString('utf8'))
        //console.log(hentay.get_state())
    })
})

console.log("Start hentaypol ping test")
//var control = new ControlModel()

