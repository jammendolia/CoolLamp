# Home Assistant investigation

Source review: 2026-09-22. This is a proposal, not an implemented or device-tested integration.

## Recommended first version

Implement a local-polling custom Home Assistant integration using CoolLamp's
existing authenticated HTTP API. Start with firmware 1.4.1 as the tested baseline.
The phone need not be running: Home Assistant talks directly to each lamp on Wi-Fi.
No firmware or mobile changes appear necessary for an initial prototype.

Once installed, the integration can discover `_coollamp._tcp.local.` services,
ask for the existing lamp access password, verify the identity through `/api/state`,
and create one device and one light entity per lamp. Manual address entry should
also work. Use the stable chip identifier for identity, never its IP or display name.
Discovery metadata alone must not authorize a connection or command.

Expose power, brightness, RGB color and the lamp-provided effect list first.
An Identify button is a small additional feature. Speed, intensity, secondary color,
default restoration and firmware update entities can follow after basic control
and recovery are validated. Do not advertise transitions or native color-temperature
control: the current control protocol does not implement them.

## Alternatives

| Approach | Benefits | Costs |
| --- | --- | --- |
| Custom HTTP integration | Reuses current firmware, discovery and authentication; no broker | Users install custom integration; polled state; Python integration maintenance |
| MQTT discovery in firmware | Uses Home Assistant's built-in MQTT support; can push knob/app state changes | Requires broker, firmware client, broker configuration, credentials, reconnect handling and memory/OTA validation |
| REST commands plus template light | Useful for a small experiment without custom Python | Manual configuration; boot-token, availability, catalog and multi-lamp handling become cumbersome |
| Bluetooth integration | Could control lamps without home Wi-Fi | Current firmware accepts one BLE connection; conflicts with direct phone control and requires bonding support |

MQTT is a reasonable alternative if built-in Home Assistant support is the priority.
It should publish discovery, confirmed state and availability, recover after broker
and Home Assistant restarts, and never retain command messages. Configuration would
need a place in the app or setup webpage. Measure its actual memory cost alongside
Bluetooth and HTTPS firmware downloads rather than assuming it fits.

## Existing API mapping

| Purpose | Endpoint |
| --- | --- |
| Identity, state, boot token and firmware status | GET `/api/state` |
| Effect names, IDs and metadata | GET `/api/effects` |
| Power | POST `/api/power`, `on=0/1` |
| Effect and brightness | POST `/api/preview`, `mode`, `brightness`, optional `keepPower=1` |
| Primary RGB or restore defaults | POST `/api/color`, `mode`, RGB values or `reset=1` |
| Speed, intensity and secondary color | POST `/api/effect-options` |
| Identify | POST `/api/identify` |

Requests use HTTP Basic authentication with username `lamp` and the lamp password.
Mutations additionally require `X-Lamp-Token` from `/api/state`; it changes on reboot.
The connection is local HTTP, with the same unencrypted-LAN limitation as the app.
Do not follow redirects or include credentials/tokens in diagnostic output.

## Behavior that needs explicit design

- Poll through one shared coordinator per lamp, initially every five seconds
  as a measurement starting point. Refresh after commands and back off on failures.
  Physical knob and phone changes will appear on the next successful poll.
- Serialize commands and polling within the integration. A confirmed stale-token
  rejection can trigger identity/state refresh and a bounded retry; an ambiguous
  timeout must not automatically replay a mutation.
- `/api/preview` requires both mode and brightness. Refresh before composing a
  partial change, but acknowledge that another client can still act between requests.
  A future firmware endpoint accepting partial, atomic changes would avoid this
  specific stale-field overwrite problem and benefit the phone app too.
- RGB commands select an effect and alter its saved-in-RAM color slot. Propose that
  RGB alone selects Custom solid, while RGB plus an explicit effect colors that
  effect. Document this choice and test restoring scenes. Do not silently reset
  every effect's stored colors when selecting it.
- The catalog does not yet identify a semantic solid-color effect. ID 29 is known
  for this firmware, but cannot be assumed for every future lamp style. Supporting
  those styles generically requires a catalog capability or agreed RGB semantics.
- Standard light brightness must handle zero as off; the lamp brightness field
  itself accepts 1–255. Turning on with parameters should apply the intended values
  before illuminating where possible.
- Ordinary automation commands should not save startup defaults. Persistence is
  an explicit user action, matching the app.
- Handle password changes through reauthentication, IP changes through rediscovery,
  reboots through token refresh, and OTA through temporary unavailability/busy state.

## Implementation and validation scope

Keep an asynchronous Python API client separate from Home Assistant entity code.
The integration needs a manifest, discovery/manual configuration flow,
reauthentication, coordinator, light platform, translations and tests.
Publish as a custom integration first; inclusion in Home Assistant Core is a
separate review process with additional requirements, including a communication library.

Test authentication, token rotation, identity mismatches, malformed catalogs,
timeouts without replay, combined light commands, availability and entity deduplication.
Then validate with a real Home Assistant instance and lamp: simultaneous phone/knob
control, two lamps, IP changes, restarts, password changes, OTA and polling load.
No Home Assistant runtime or hardware tests were performed for this investigation.

## Official references

- [Integration discovery](https://developers.home-assistant.io/docs/core/integration-quality-scale/rules/discovery/)
- [Light entity](https://developers.home-assistant.io/docs/core/entity/light/)
- [Shared polling coordinator](https://developers.home-assistant.io/docs/integration_fetching_data/)
- [Configuration flows](https://developers.home-assistant.io/docs/core/integration/config_flow/)
- [MQTT discovery](https://www.home-assistant.io/integrations/mqtt/)
- [MQTT lights](https://www.home-assistant.io/integrations/light.mqtt/)
- [REST commands](https://www.home-assistant.io/integrations/rest_command/)
- [Template entities](https://www.home-assistant.io/integrations/template/)
- [Contributing to Core](https://developers.home-assistant.io/docs/core/integration/contributing_to_core/)
