export const homeContractV1Fixture = {
  version: 1,
  snapshots: [
    {
      version: 1,
      home: {
        id: 'home.primary',
        name: 'Primary home',
        mode: 'hybrid',
        timezone: 'America/Chicago',
        location: { latitude: 41.8781, longitude: -87.6298 },
        revision: 27,
        authorizationRevision: 8
      },
      authority: {
        serviceId: 'service.primary.authority',
        hostDeviceId: 'a10000000001',
        generation: 4,
        bootSession: 'a100000000000004',
        state: 'ready'
      },
      sequence: 41,
      people: [
        { id: 'person.joe', name: 'Joe' },
        { id: 'person.lisa', name: 'Lisa' }
      ],
      memberships: [
        { id: 'membership.primary.joe', personId: 'person.joe', role: 'owner', status: 'active' },
        { id: 'membership.primary.lisa', personId: 'person.lisa', role: 'member', status: 'active' }
      ],
      installations: [
        { id: 'installation.joe.iphone', personId: 'person.joe', name: 'Joe’s iPhone', status: 'active' },
        { id: 'installation.lisa.iphone', personId: 'person.lisa', name: 'Lisa’s iPhone', status: 'active' },
        { id: 'installation.lisa.oldphone', personId: 'person.lisa', name: 'Lisa’s old phone', status: 'revoked' }
      ],
      grants: [
        {
          id: 'grant.primary.joe.iphone',
          kind: 'member',
          subjectType: 'membership',
          subjectId: 'membership.primary.joe',
          installationId: 'installation.joe.iphone',
          authorizationRevision: 8,
          permissions: ['control', 'organize', 'automations', 'people', 'device-care', 'integrations'],
          scope: { kind: 'home', targets: [] },
          status: 'active',
          expiresAt: null
        },
        {
          id: 'grant.primary.lisa.iphone',
          kind: 'member',
          subjectType: 'membership',
          subjectId: 'membership.primary.lisa',
          installationId: 'installation.lisa.iphone',
          authorizationRevision: 8,
          permissions: ['control', 'automations'],
          scope: { kind: 'home', targets: [] },
          status: 'active',
          expiresAt: null
        },
        {
          id: 'grant.primary.lisa.oldphone',
          kind: 'member',
          subjectType: 'membership',
          subjectId: 'membership.primary.lisa',
          installationId: 'installation.lisa.oldphone',
          authorizationRevision: 7,
          permissions: ['control'],
          scope: { kind: 'home', targets: [] },
          status: 'revoked',
          expiresAt: null
        },
        {
          id: 'grant.primary.ha',
          kind: 'integration',
          subjectType: 'integration',
          subjectId: 'integration.primary.ha',
          installationId: null,
          authorizationRevision: 8,
          permissions: ['control', 'automations', 'device-care'],
          scope: { kind: 'home', targets: [] },
          status: 'active',
          expiresAt: null
        }
      ],
      rooms: [
        { id: 'room.living', name: 'Living room' },
        { id: 'room.hallway', name: 'Hallway' }
      ],
      devices: [
        {
          id: 'a10000000001',
          name: 'Home hub',
          kind: 'bridge',
          roomId: null,
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:30:00Z' },
          capabilities: ['home-authority', 'schedule-executor', 'away-access', 'device-relay'],
          audioInput: { installed: false, available: false, canDriveOtherLights: false }
        },
        {
          id: 'c10000000001',
          name: 'Helix',
          kind: 'coollamp',
          roomId: 'room.living',
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:29:58Z' },
          capabilities: ['light', 'effects', 'audio-input'],
          audioInput: { installed: true, available: true, canDriveOtherLights: false }
        },
        {
          id: 'c10000000002',
          name: 'Edison',
          kind: 'coollamp',
          roomId: 'room.living',
          state: { reachability: 'unreachable', freshness: 'stale', confirmedAt: '2026-11-17T14:55:00Z' },
          capabilities: ['light', 'effects', 'audio-input'],
          audioInput: { installed: true, available: false, canDriveOtherLights: false }
        },
        {
          id: 'd10000000001',
          name: 'Window display',
          kind: 'coolstrip-controller',
          roomId: 'room.hallway',
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:29:57Z' },
          capabilities: ['light', 'linear-output', 'matrix-output', 'device-relay'],
          audioInput: { installed: false, available: false, canDriveOtherLights: false }
        }
      ],
      groups: [
        {
          id: 'group.evening',
          name: 'Evening lights',
          members: [
            { deviceId: 'c10000000001', participation: 'playing' },
            { deviceId: 'c10000000002', participation: 'separate' },
            { deviceId: 'd10000000001', participation: 'playing' }
          ]
        }
      ],
      scenes: [
        { id: 'scene.quiet-evening', name: 'Quiet evening', targets: [{ kind: 'group', id: 'group.evening' }] }
      ],
      schedules: [
        {
          id: 'schedule.window-evenings',
          name: 'Window display evenings',
          enabled: true,
          executorServiceId: 'service.primary.schedules',
          trigger: { kind: 'sunset', minute: null, offsetMinutes: 0, days: [0, 1, 2, 3, 4, 5, 6] },
          actions: [
            { kind: 'apply-scene', target: { kind: 'group', id: 'group.evening' } },
            { kind: 'power-off', target: { kind: 'device', id: 'd10000000001' } }
          ],
          state: 'ready'
        }
      ],
      services: [
        { id: 'service.primary.authority', name: 'Home authority', kind: 'home-authority', hostDeviceId: 'a10000000001', state: 'ready' },
        { id: 'service.primary.schedules', name: 'Schedules', kind: 'schedule-executor', hostDeviceId: 'a10000000001', state: 'ready' },
        { id: 'service.primary.away', name: 'Control while away', kind: 'away-access', hostDeviceId: 'a10000000001', state: 'ready' },
        { id: 'service.primary.window-relay', name: 'Nearby light connection', kind: 'device-relay', hostDeviceId: 'd10000000001', state: 'ready' }
      ],
      integrations: [
        { id: 'integration.primary.ha', name: 'Home Assistant', kind: 'home-assistant', status: 'connected', grantId: 'grant.primary.ha' },
        { id: 'integration.primary.alexa', name: 'Alexa', kind: 'alexa', status: 'disconnected', grantId: null }
      ]
    },
    {
      version: 1,
      home: {
        id: 'home.lake',
        name: 'Lake house',
        mode: 'hybrid',
        timezone: 'America/Detroit',
        location: { latitude: 44.3148, longitude: -85.6024 },
        revision: 12,
        authorizationRevision: 3
      },
      authority: {
        serviceId: 'service.lake.authority',
        hostDeviceId: 'a20000000001',
        generation: 2,
        bootSession: 'a200000000000002',
        state: 'ready'
      },
      sequence: 17,
      people: [
        { id: 'person.joe', name: 'Joe' },
        { id: 'person.lisa', name: 'Lisa' }
      ],
      memberships: [
        { id: 'membership.lake.joe', personId: 'person.joe', role: 'owner', status: 'active' },
        { id: 'membership.lake.lisa', personId: 'person.lisa', role: 'guest', status: 'active' }
      ],
      installations: [
        { id: 'installation.joe.iphone', personId: 'person.joe', name: 'Joe’s iPhone', status: 'active' },
        { id: 'installation.lisa.iphone', personId: 'person.lisa', name: 'Lisa’s iPhone', status: 'active' }
      ],
      grants: [
        {
          id: 'grant.lake.joe.iphone',
          kind: 'member',
          subjectType: 'membership',
          subjectId: 'membership.lake.joe',
          installationId: 'installation.joe.iphone',
          authorizationRevision: 3,
          permissions: ['control', 'organize', 'automations', 'people', 'device-care', 'integrations'],
          scope: { kind: 'home', targets: [] },
          status: 'active',
          expiresAt: null
        },
        {
          id: 'grant.lake.lisa.help',
          kind: 'temporary-help',
          subjectType: 'membership',
          subjectId: 'membership.lake.lisa',
          installationId: 'installation.lisa.iphone',
          authorizationRevision: 3,
          permissions: ['control', 'device-care'],
          scope: { kind: 'targets', targets: [{ kind: 'device', id: 'c20000000001' }] },
          status: 'active',
          expiresAt: '2026-11-23T23:00:00Z'
        },
        {
          id: 'grant.lake.ha.revoked',
          kind: 'integration',
          subjectType: 'integration',
          subjectId: 'integration.lake.ha',
          installationId: null,
          authorizationRevision: 2,
          permissions: ['control'],
          scope: { kind: 'home', targets: [] },
          status: 'revoked',
          expiresAt: null
        }
      ],
      rooms: [
        { id: 'room.deck', name: 'Deck' },
        { id: 'room.guest', name: 'Guest room' }
      ],
      devices: [
        {
          id: 'a20000000001',
          name: 'Lake house hub',
          kind: 'bridge',
          roomId: null,
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:30:00Z' },
          capabilities: ['home-authority', 'schedule-executor', 'away-access', 'device-relay'],
          audioInput: { installed: false, available: false, canDriveOtherLights: false }
        },
        {
          id: 'c20000000001',
          name: 'Deck Helix',
          kind: 'coollamp',
          roomId: 'room.deck',
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:29:54Z' },
          capabilities: ['light', 'effects', 'audio-input'],
          audioInput: { installed: true, available: true, canDriveOtherLights: false }
        },
        {
          id: 'c20000000002',
          name: 'Guest lamp',
          kind: 'coollamp',
          roomId: 'room.guest',
          state: { reachability: 'reachable', freshness: 'fresh', confirmedAt: '2026-11-17T15:29:50Z' },
          capabilities: ['light', 'effects', 'audio-input'],
          audioInput: { installed: true, available: true, canDriveOtherLights: false }
        }
      ],
      groups: [
        { id: 'group.deck', name: 'Deck lights', members: [{ deviceId: 'c20000000001', participation: 'playing' }] }
      ],
      scenes: [
        { id: 'scene.lakeside', name: 'Lakeside glow', targets: [{ kind: 'group', id: 'group.deck' }] }
      ],
      schedules: [
        {
          id: 'schedule.porch',
          name: 'Porch at sunset',
          enabled: true,
          executorServiceId: 'service.lake.schedules',
          trigger: { kind: 'sunset', minute: null, offsetMinutes: 0, days: [0, 1, 2, 3, 4, 5, 6] },
          actions: [{ kind: 'apply-scene', target: { kind: 'group', id: 'group.deck' } }],
          state: 'ready'
        }
      ],
      services: [
        { id: 'service.lake.authority', name: 'Home authority', kind: 'home-authority', hostDeviceId: 'a20000000001', state: 'ready' },
        { id: 'service.lake.schedules', name: 'Schedules', kind: 'schedule-executor', hostDeviceId: 'a20000000001', state: 'ready' },
        { id: 'service.lake.away', name: 'Control while away', kind: 'away-access', hostDeviceId: 'a20000000001', state: 'ready' }
      ],
      integrations: [
        { id: 'integration.lake.ha', name: 'Home Assistant', kind: 'home-assistant', status: 'revoked', grantId: 'grant.lake.ha.revoked' }
      ]
    }
  ],
  events: [
    {
      version: 1,
      homeId: 'home.primary',
      authorityGeneration: 4,
      bootSession: 'a100000000000004',
      sequence: 42,
      authorizationRevision: 8,
      occurredAt: '2026-11-17T15:31:00Z',
      change: 'state-confirmed',
      resource: { kind: 'group', id: 'group.evening' }
    },
    {
      version: 1,
      homeId: 'home.lake',
      authorityGeneration: 2,
      bootSession: 'a200000000000002',
      sequence: 18,
      authorizationRevision: 3,
      occurredAt: '2026-11-17T15:31:04Z',
      change: 'state-confirmed',
      resource: { kind: 'device', id: 'c20000000001' }
    },
    {
      version: 1,
      homeId: 'home.primary',
      authorityGeneration: 4,
      bootSession: 'a100000000000004',
      sequence: 43,
      authorizationRevision: 8,
      occurredAt: '2026-11-17T15:31:08Z',
      change: 'state-stale',
      resource: { kind: 'device', id: 'c10000000002' }
    }
  ]
};
