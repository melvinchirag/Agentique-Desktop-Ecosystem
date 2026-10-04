# X0 overlay spike

Run on the Windows desktop being tested:

```sh
cd spikes/x0-overlay
npm install
npm start                                   # defaults: forward pointer, floating level
npm start -- --pointer poll
npm start -- --level screen-saver --toolbar
npm run start:nogpu                         # if the background is black
```

Move the pointer over the cube and its bubble. Click the cube to change its color and message. Hold it for at least 250 ms, then release, to record a short microphone clip. Type in the Hub to update the bubble. Press Esc to blur the input. Press Ctrl+Q in the Hub or close the Hub to print and write `X0-REPORT.md`.

Check the report's manual boxes on this display: the background is transparent; clicks away from the cube reach apps underneath; the overlay is absent from Alt-Tab and the taskbar; the Hub accepts typing without the overlay stealing focus; and the placement looks right at the current display scale. Compare the forward and poll runs if forwarded mouse movement fails. In poll mode, the forwarded-mousemove auto check is expected to fail because that mode does not use forwarded events.
