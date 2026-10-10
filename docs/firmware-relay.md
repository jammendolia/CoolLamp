# Firmware updates across paired lamps

The ESP-NOW firmware relay introduced in the 1.12.0 draft is included in public
firmware 1.13.0 alongside Wi-Fi OTA and phone-to-lamp Bluetooth updates. Physical
relay acceptance remains pending; the separate 1.12.0 draft is preserved.

The app checks the public release manifest asynchronously when Lamps opens.
An up-arrow appears only for a known installed version older than that release.
Continue authorizes that lamp and that exact version; Cancel sends no mutation.
Wi-Fi is preferred. Offline lamps, or lamps with a confirmed failure during the
pre-install check, can use an existing authorized Bluetooth connection. The phone
downloads the pinned release manifest and image and verifies size, chip and SHA-256.
An uncertain Wi-Fi installation is not replayed over Bluetooth. Bluetooth requires
an initial installation of 1.11.0 or newer. The card retains an unconfirmed final
result until the lamp's installed version can be checked after reconnecting.

## Fleet trust

The phone generates one random 128-bit fleet credential, stores it in its native
credential vault, and provisions it only through an encrypted, authenticated BLE
RPC to a lamp already paired with that phone. Provisioning is independent of lamp
group membership. A different existing fleet credential is never silently
replaced. Keys are absent from HTTP routes, status replies, cards and diagnostics.
Factory reset clears the credential with the existing CoolLamp NVS namespace.
The trust persists on the lamp; removing a phone-only card from an unreachable
lamp cannot remotely revoke a credential. Another phone cannot silently adopt
an existing fleet. These owner/revocation workflows remain a follow-up.

This is a trusted-fleet model: a holder of the fleet credential can authenticate
firmware offers. SHA-256 provides byte integrity, not an independent publisher
signature. No unauthenticated neighbor, or lamp with only a different group key,
can send an accepted firmware image.

## Relay behavior

A donor hashes the exact running public C3 application, incrementally and only
after its boot has settled. It advertises that image's version, length and SHA-256.
Only a receiver with Automatic Updates enabled and strictly older firmware starts
a request. A fresh receiver session and donor offer challenge bind the transfer;
replaying an old offer alone cannot reserve the flash updater. Turning the LEDs
off does not turn off the device or its update service.

Each receiver writes the inactive OTA slot through the same verified receiver
used by Bluetooth. It validates the C3 image header, matching public-build marker,
full SHA-256, and ESP-IDF image validation before selecting the next boot slot.
Group, hardware, Wi-Fi, name and microphone settings remain in NVS. Only one image
transfer owns a lamp at a time. Group streaming pauses during a transfer and
resumes afterward; Wi-Fi and Bluetooth installation paths remain available when
no relay owns the updater.

ESP-NOW packets use a separate AES-GCM/HMAC domain from group coordination,
bind sender and recipient MACs, and use a boot nonce and monotonic sequence.
Data is paced by written-offset acknowledgements. Lost data or acknowledgements
allow bounded retries; duplicate data never writes twice. Repeated Finish packets
only acknowledge an already committed image and never repeat boot selection.
Inactive transfers expire after 20 seconds, complete transfers are bounded to
15 minutes, and failed attempts have a one-minute receiver cooldown. A newly
updated, healthy lamp can subsequently donate its version to other older lamps.

All peers must share the current 2.4 GHz radio channel. Associated Wi-Fi stations
follow their AP channel; ESP-NOW is not an independent radio and cannot bridge
different channels. Offline peers use the existing channel discovery behavior.

## Validation

`tests/firmware-relay-runtime.py` compiles the production sender and recipient
state machines and shared flash receiver, using the pinned real Mbed TLS
AES-GCM and SHA-256 implementation. It covers success, opt-out, different fleet,
an image lacking the donor's public marker, lost data/ACK/final ACK, authenticated
corrupted data, mid-transfer opt-out and radio loss. Existing BLE and hybrid
coordination tests remain separate regression checks.

Physical acceptance is still required: provision two paired test lamps, verify
cross-group transfer with an offline receiver, test interruption before commit,
verify saved settings and new boot, measure stack/heap and transfer time, then
observe a subsequent donation to a third auto-update-enabled lamp. Do not publish
this candidate as proven mesh OTA merely because host tests and CI succeed.
