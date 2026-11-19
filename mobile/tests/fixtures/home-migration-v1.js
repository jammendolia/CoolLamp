export const homeMigrationV1Fixture = {
  version: 1,
  destinationHome: { id: 'home.primary', name: 'Primary home' },
  sources: [
    {
      sourceId: 'phone.joe',
      kind: 'phone',
      capturedAt: '2026-11-17T16:00:00Z',
      homeContext: {
        version: 1,
        activeHomeId: 'local-home',
        homes: [{ id: 'local-home', name: 'My home', mode: 'local-only' }]
      },
      lampRecords: [
        {
          id: 'a10000000001',
          deviceId: 'native-edison-accessory',
          name: 'Edison',
          room: 'Living room',
          phoneLampStyle: 'edison',
          identityConfirmed: true,
          homeBoundaryConfirmed: true,
          reachable: false,
          address: '192.0.2.41',
          hostname: 'edison.local'
        },
        {
          id: 'a10000000002',
          deviceId: 'native-left-helix',
          name: 'Helix',
          room: 'My home',
          phoneLampStyle: 'helix',
          identityConfirmed: true,
          homeBoundaryConfirmed: true,
          reachable: true
        },
        {
          id: 'a10000000003',
          deviceId: 'native-right-helix',
          name: 'Helix',
          room: 'Living room',
          phoneLampStyle: 'helix',
          identityConfirmed: true,
          homeBoundaryConfirmed: true,
          reachable: true
        },
        {
          id: 'ble:native-porch-accessory',
          deviceId: 'native-porch-accessory',
          name: 'Porch lamp',
          room: 'Porch',
          reachable: false,
          accessToken: 'must-never-leave-the-collector'
        }
      ],
      appPreferences: {
        rooms: {
          a10000000001: 'Office',
          a10000000002: 'Living room',
          a10000000003: 'Living room'
        },
        groups: { a10000000002: 'Evening lights' }
      },
      groupSnapshot: {
        groups: [
          {
            id: 'a10000000002',
            name: 'Helix',
            leader: {
              id: 'a10000000002',
              verified: true,
              sync: { active: true, paused: false }
            },
            followers: [
              {
                id: 'a10000000001',
                verified: true,
                sync: { active: false, paused: true }
              },
              {
                id: 'a10000000003',
                verified: true,
                sync: { active: false, paused: false }
              }
            ],
            removalPending: false,
            dissolutionPending: false,
            pendingRemovalIds: []
          }
        ]
      },
      groupRemovalIntents: { version: 1, sources: [] },
      savedLooksEnvelope: {
        version: 1,
        looks: [
          {
            version: 1,
            id: 'warm-evening',
            createdAt: 1794931200000,
            lampId: 'a10000000001',
            name: 'Warm evening',
            effect: { localId: 4, name: 'Fire', key: 'fire' },
            appearance: {
              brightness: 144,
              color: [0, 255, 132, 48],
              options: [60, 20, 0, 128, 90, 30]
            }
          }
        ]
      },
      bridgeRecords: [
        {
          id: 'b10000000001',
          role: 'bridge',
          modelId: 'coollamp.bridge.heltec-wifi-kit32-v3',
          name: 'Home hub',
          firmwareVersion: '0.4.0-dev',
          capabilities: ['mesh-control', 'trusted-cached-donation'],
          address: '192.0.2.50',
          meshBridgeId: 'legacy-route-1',
          fleetId: 'legacy-fleet',
          verifiedAt: '2026-11-17T15:58:00Z'
        }
      ]
    },
    {
      sourceId: 'phone.lisa',
      kind: 'phone',
      capturedAt: '2026-11-17T16:01:00Z',
      lampRecords: [
        {
          id: 'a10000000001',
          deviceId: 'lisa-native-edison',
          name: 'Edison',
          room: 'Living room',
          identityConfirmed: false,
          homeBoundaryConfirmed: false
        }
      ],
      appPreferences: {
        rooms: { a10000000001: 'Office' },
        groups: { a10000000002: 'Evening lights' }
      },
      savedLooksEnvelope: { version: 1, looks: [] },
      bridgeRecords: []
    }
  ],
  coolStripSnapshots: [
    {
      sourceId: 'front-window-controller',
      capturedAt: '2026-11-17T16:02:00Z',
      verifiedRead: true,
      controllerId: 'c10000000001',
      name: 'Front windows',
      room: 'Front of house',
      homeBoundaryConfirmed: true,
      microphoneInstalled: false,
      address: '192.0.2.60',
      geometry: {
        top: 47,
        right: 90,
        bottom: 47,
        left: 90,
        startCorner: 'top-left',
        direction: 'clockwise'
      },
      outputs: [
        { kind: 'perimeter', pixelCount: 274, name: 'Window frame' },
        { kind: 'matrix', pixelCount: 120, name: 'Window picture' }
      ],
      matrix: {
        installed: true,
        columns: 8,
        rows: 13,
        rowStride: 9,
        firstPixelIndex: 273,
        padding: { top: 2, right: 3, bottom: 2, left: 3 }
      },
      schedule: {
        automatic: true,
        locationConfigured: true,
        timezone: 'America/Chicago'
      }
    }
  ]
};
