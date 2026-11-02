# ADE 0.2.0 release notes

## What changed

- A fresh install opens ADE Setup when there is no Backboard key. Paste your own key, verify it, and choose **Save and create assistants**. ADE creates the missing assistants, then offers a restart. You can also try the offline demo from Setup.
- Chip can run with Backboard alone. Tiger Data is optional; without it, Timeline, Pulse, Audit, and Replay history are off, and the Hub explains why. Warden still checks actions.
- Several broken characters in demo speech and approval text were repaired.
- New installs default each animal to Google Gemini 2.5 Flash. The model picker includes it, and existing saved model choices remain in place.

## Current limits

- Gmail connection for a new user still depends on Google OAuth app verification and access. Setup does not grant that access.
- Generated creature voices need an ElevenLabs key. The key is optional during Setup; without it, generated voices are unavailable.
- The Windows installer is not code signed yet, so Windows may show an unknown publisher warning.

## Manual clean-install check on Windows

Use a fresh Windows user profile or VM with no existing ADE settings or configured keys. Use a 0.2.0 installer artifact when one is built; this integration did not build an installer.

1. Install ADE 0.2.0 and launch it normally. Confirm that **ADE Setup** opens before the forest and Hub.
2. Choose **Try the offline demo instead**. Confirm that the forest and Hub open, then trigger the frustration and Warden approval demos. Check that bubbles and approval text have readable punctuation and apostrophes.
3. Close ADE and launch it normally again. In Setup, paste a Backboard key you own and select **Verify**. Confirm a connected balance appears. Check that the key itself is never shown in full.
4. Leave ElevenLabs blank, select **Save and create assistants**, wait for each assistant to show **ready**, then select **Restart ADE to finish**. Confirm the forest and Hub open and Chip answers a simple text message.
5. With no Tiger Data connection configured, open **Timeline**, **Pulse**, and **Audit**. Each should show the same history-off explanation instead of a data view. Confirm Settings shows Tiger Data as not configured.
6. In Settings, confirm Gemini 2.5 Flash is selected for a new install. Change one animal to another model, restart ADE, and confirm that choice persists.
7. In Settings, select **Change keys**. Confirm the existing keys appear only as the first four characters followed by a mask. Leave the values unchanged and close Setup.
8. If the test profile has approved Google OAuth access, try **Connect Google** and verify the result separately. If it has an ElevenLabs key, repeat with the key to verify generated voice separately. If Tiger Data is configured, repeat the history views to verify stored data separately.

Never paste keys, connection strings, or certificate contents into a test report.

## Account

When ADE account setup is enabled, first run asks for an email and a six-digit sign-in code before the Backboard step. ADE stores the email, a random device identifier, app version, and first and last use timestamps for install and active-user counts. It does not send files, mail, memories, or desktop content to the account service. In Settings > Account, choose **Sign out** to remove the local session and stop the heartbeat. The sign-in step returns on the next launch. Existing install history remains in the service.
