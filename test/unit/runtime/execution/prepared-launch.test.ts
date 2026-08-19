import { expect, test } from 'vitest';

import { PreparedLaunch } from '../../../../src/runtime/execution/index.js';

const effectiveLimits = Object.freeze({
  wallClockTimeoutMs: 1_000,
  idleTimeoutMs: 1_000,
  maxEventBytes: 65_536,
  maxEventsFileBytes: 16_777_216,
  maxStdoutBytes: 8_388_608,
  maxStderrBytes: 8_388_608,
  maxRawResponseBytes: 1_048_576,
});

test('rejects prepared launch evidence without a reported version', () => {
  expect(
    PreparedLaunch.create({
      pin: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
      executable: '/usr/bin/codex',
    }),
  ).toBeUndefined();
});

test('creates prepared launch evidence with the exact execution-owned shape', () => {
  expect(
    PreparedLaunch.create({
      pin: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
      limits: effectiveLimits,
    }),
  ).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
  });
});

test('accepts null-prototype record containers', () => {
  const pin = {
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
  };
  const candidate = {
    pin,
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
  };
  Object.setPrototypeOf(pin, null);
  Object.setPrototypeOf(candidate, null);

  expect(PreparedLaunch.create(candidate)).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
  });
});

test('rejects non-object outer and pin containers', () => {
  for (const candidate of [undefined, null, false, 'launch', [], () => undefined]) {
    expect(PreparedLaunch.create(candidate)).toBeUndefined();
  }

  for (const pin of [undefined, null, false, 'pin', []]) {
    expect(
      PreparedLaunch.create({
        pin,
        executable: '/usr/bin/codex',
        reportedVersion: '1.2.3',
      }),
    ).toBeUndefined();
  }
});

test('rejects Date and class-instance outer and pin containers', () => {
  class LaunchContainer {
    readonly pin = {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    };
    readonly executable = '/usr/bin/codex';
    readonly reportedVersion = '1.2.3';
  }

  class PinContainer {
    readonly agentId = 'codex';
    readonly agentVersion = '1.0.0';
    readonly definitionDigest = 'definition-digest';
  }

  const pin = {
    agentId: 'codex',
    agentVersion: '1.0.0',
    definitionDigest: 'definition-digest',
  };
  const dateLaunch = Object.assign(new Date(0), {
    pin,
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  });
  const datePin = Object.assign(new Date(0), pin);

  expect(PreparedLaunch.create(dateLaunch)).toBeUndefined();
  expect(PreparedLaunch.create(new LaunchContainer())).toBeUndefined();
  expect(
    PreparedLaunch.create({
      pin: datePin,
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({
      pin: new PinContainer(),
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();
});

test('rejects non-exact own data-property shapes', () => {
  const outerExtra = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    extra: true,
  };
  const pinExtra = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
      extra: true,
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const outerSymbol = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    [Symbol('extra')]: true,
  };
  const pinSymbol = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
      [Symbol('extra')]: true,
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const outerAccessor = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    get executable() {
      return '/usr/bin/codex';
    },
    reportedVersion: '1.2.3',
  };
  const pinPropertyAccessor = {
    get pin() {
      return {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      };
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const pinAccessor = {
    pin: {
      get agentId() {
        return 'codex';
      },
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };
  const replacedOuterKey = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    version: '1.2.3',
  };
  const replacedPinKey = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      digest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
  };

  for (const candidate of [
    outerExtra,
    pinExtra,
    outerSymbol,
    pinSymbol,
    outerAccessor,
    pinPropertyAccessor,
    pinAccessor,
    replacedOuterKey,
    replacedPinKey,
  ]) {
    expect(PreparedLaunch.create(candidate)).toBeUndefined();
  }
});

test('rejects missing, empty, and wrong-type semantic values', () => {
  const exact = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
  };

  expect(PreparedLaunch.create({ ...exact, executable: '' })).toBeUndefined();
  expect(PreparedLaunch.create({ ...exact, reportedVersion: 123 })).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, definitionDigest: '' } }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, agentVersion: false } }),
  ).toBeUndefined();
  expect(
    PreparedLaunch.create({ ...exact, pin: { ...exact.pin, agentId: undefined } }),
  ).toBeUndefined();
});

test('copies caller containers and deeply freezes prepared launch evidence', () => {
  const candidate = {
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: { ...effectiveLimits },
  };

  const prepared = PreparedLaunch.create(candidate);
  if (prepared === undefined) throw new Error('Expected valid prepared launch evidence');

  expect(prepared).not.toBe(candidate);
  expect(prepared.pin).not.toBe(candidate.pin);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.isFrozen(prepared.pin)).toBe(true);
  expect(Object.isFrozen(prepared.limits)).toBe(true);

  candidate.pin.agentId = 'mutated';
  candidate.executable = '/tmp/mutated';
  expect(prepared).toEqual({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits: effectiveLimits,
  });
});

test('requires copied effective limits in finalization material', () => {
  const limits = {
    wallClockTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    maxEventBytes: 65_536,
    maxEventsFileBytes: 16_777_216,
    maxStdoutBytes: 8_388_608,
    maxStderrBytes: 8_388_608,
    maxRawResponseBytes: 1_048_576,
  };

  expect(
    PreparedLaunch.create({
      pin: {
        agentId: 'codex',
        agentVersion: '1.0.0',
        definitionDigest: 'definition-digest',
      },
      executable: '/usr/bin/codex',
      reportedVersion: '1.2.3',
    }),
  ).toBeUndefined();

  const prepared = PreparedLaunch.create({
    pin: {
      agentId: 'codex',
      agentVersion: '1.0.0',
      definitionDigest: 'definition-digest',
    },
    executable: '/usr/bin/codex',
    reportedVersion: '1.2.3',
    limits,
  });

  expect(prepared).toMatchObject({ limits });
  limits.wallClockTimeoutMs = 2_000;
  expect(prepared).toMatchObject({ limits: { wallClockTimeoutMs: 1_000 } });
  expect(Object.isFrozen(prepared?.limits)).toBe(true);
});
