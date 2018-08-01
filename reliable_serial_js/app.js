var Hentaypol = require('./hentaypol')
var ControlModel = require('./controlmodel')

var hentay = new Hentaypol('/dev/ttyUSB0', { baudRate : 57600 }, function(err) {    
    hentay.on_ping(function(id){
        console.log('got ping with id :',id)
        console.log(hentay.get_state())
    })

    hentay.on_data(function(data){
        console.log('get data')
        console.log(data)
        console.log(hentay.get_state())
    })

    setInterval(function(){
        console.log('send ping')
        hentay.ping(
            function(e){
                console.log(e)
            }
        )
    }, 1500)

    setInterval(function(){
        console.log('send data')
        hentay.send(
            {
                type : 'array_byte',
                reliable : false,
                payload : 'hello world'
            },
            function(id,e){
                console.log('data send status ' + id)
                console.log(e)
            }
        )
    }, 100)

})

console.log("Start hentaypol ping test")
//var control = new ControlModel()

