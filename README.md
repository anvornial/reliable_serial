# Reliable Serial
Implement more reliable serial with
 * SLIP as framing methods
 * Error detection using crc8-maxim
 * Realibility using retransmission

All sources are licensed in MIT

## Frame format
NOTE : byte order in LSB to MSB
> [packet][crc8][slip_end]  
> [packet_more_than_60byte][crc8-1][crc8-2][slip_end]

## Packet Format
### Realibility
Sender and receiver use id (uint8) to track each session
#### Send using Realibility (sender ->  receiver)
> [b][id][payload]
#### Then acknowledge (ACK) it when received correctly (sender <- receiver)
> [B][id]

### Ping packet aka heartbeat
#### Send ping
> [p]
#### Send pong
> [P]

## Notes

more note on implementation of slip
* https://tools.ietf.org/html/rfc1055
* https://en.wikibooks.org/wiki/Serial_Programming/IP_Over_Serial_Connections
* https://en.wikipedia.org/wiki/Serial_Line_Internet_Protocol
* https://www.cse.iitb.ac.in/~bestin/pdfs/slip.pdf
* https://www.npmjs.com/package/slip
* https://github.com/bakercp/PacketSerial

more note on implementation of crc8 on arduino
* http://www.leonardomiliani.com/en/2013/un-semplice-crc8-per-arduino/
* https://www.maximintegrated.com/en/app-notes/index.mvp/id/27

more note with crc8 implementation on nodejs
* https://github.com/alexgorbatchev/node-crc
