# HES Studio Control and Telemetry Protocol aka HENTAYPOL
## designed to be used on low bandwidth, stream based serial device, reliable, yet still easy to implements (LOL)

note :
more note on implementation on slip
* https://tools.ietf.org/html/rfc1055
* https://en.wikibooks.org/wiki/Serial_Programming/IP_Over_Serial_Connections#Lack_of_Framing
* https://en.wikipedia.org/wiki/Serial_Line_Internet_Protocol
* https://www.cse.iitb.ac.in/~bestin/pdfs/slip.pdf
* https://www.npmjs.com/package/slip
* https://github.com/bakercp/PacketSerial

more note on implementation of crc8 on arduino
* http://www.leonardomiliani.com/en/2013/un-semplice-crc8-per-arduino/
* https://www.maximintegrated.com/en/app-notes/index.mvp/id/27

more note with crc8 implementation on nodejs
* https://github.com/alexgorbatchev/node-crc

summary spec of HENTAYPOL
 - Using SLIP as framing methods
 - error detection using crc8-maxim
 - realibility using ack

Frame format

byte order in LSB to MSB

frame format using serial line ip
[packet][crc8][slip_end]  
[packet_more_than_60byte][crc8-1][crc8-2][slip_end]

PACKET Format

Send using Realibility (sender ->  receiver)
    [b][id]{payload}

Then acknowledge (ACK) it when received correctly (sender <- receiver)
    [B][id]                      


BASIC FORM

BASIC PAIR BYTE (REGISTER ACCESS STYLE) (KEY-VALUE pair) (gone sexual)
- send byte with index 
    [x][byte_i][byte_value_i][byte_i2][byte_value_i2][byte_iN][byte_value_iN]

BASIC ARRAY of BYTE
- send array of data 
    [z][byte_data_0][byte_data_1][byte_data_n]
    
PING aka heartbeat
- send ping
   [p]
- send pong
   [P]


// BELOW, TO BE IMPLEMENTED
EXTRA STATE PACKET
extra packet provide addressing and realibility, ack when data is received.
src and dst are 1 byte address, use 0 for broadcast address so you can use it without adressing

- send directed frame
    [a][id][src][dst]{basic_form}

- Acknowledge (ACK) when data is correctly received
    [A][id][src][dst]{basic_form}
