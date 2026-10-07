import type {
  ActualState,
  Capability,
  DesiredState,
  ProfileOverrides,
  RoleProfile,
} from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { describe, expect, it } from 'vitest';
import { createExecutionPlan } from './planner.js';
import { applyOverrides, flattenRole } from './profile-merge.js';
import { resolveCapabilities } from './resolver.js';

const baseRole: RoleProfile = {
  apiVersion: 'harness.nova/v1',
  kind: 'RoleProfile',
  metadata: {
    id: 'base-developer',
    displayName: 'Base Developer',
    description: '',
    version: '1.0.0',
  },
  extends: [],
  runtime: { default: 'claude-code' },
  capabilities: {
    required: [{ id: 'gitlab', range: '^1.0.0', reason: 'source control', configuration: {} }],
    recommended: [],
    optional: [],
    denied: [],
  },
  permissions: [
    {
      id: 'git-read',
      effect: 'allow',
      action: 'git.read',
      resource: '*',
      conditions: {},
      enforced: false,
    },
  ],
  defaults: { ui: { language: 'zh-CN' } },
};

const frontendRole: RoleProfile = {
  ...baseRole,
  metadata: {
    id: 'frontend',
    displayName: 'Frontend',
    description: '',
    version: '1.1.0',
  },
  extends: ['base-developer'],
  capabilities: {
    required: [{ id: 'workflow', range: '^2.0.0', reason: 'workflow', configuration: {} }],
    recommended: [
      { id: 'playwright', range: '^1.0.0', reason: 'browser testing', configuration: {} },
    ],
    optional: [{ id: 'database', range: '*', reason: 'optional database', configuration: {} }],
    denied: ['production-db'],
  },
  permissions: [
    {
      id: 'git-push',
      effect: 'requireApproval',
      action: 'git.push',
      resource: '*',
      conditions: {},
      enforced: true,
    },
  ],
  defaults: { ui: { density: 'comfortable' } },
};

function version(
  version: string,
  dependencies: Capability['versions'][number]['dependencies'] = [],
) {
  return {
    version,
    recommended: true,
    manifestChecksum: 'a'.repeat(64),
    dependencies,
    conflicts: [],
    runtimeBindings: {},
  };
}

function capability(id: string, versions: Capability['versions']): Capability {
  return {
    id,
    type: 'mcp',
    name: id,
    displayName: id,
    description: '',
    tags: [],
    categories: [],
    maintainers: [],
    status: 'active',
    riskLevel: 'low',
    source: { sourceId: 'fixture', kind: 'local', locator: id },
    versions,
    secrets: [],
    configuration: [],
    sourceMetadata: {},
    adminOverrides: {},
  };
}

describe('profile merge', () => {
  it('flattens inheritance and preserves nested defaults', () => {
    const flattened = flattenRole(frontendRole, {
      get: (id) => (id === 'base-developer' ? baseRole : undefined),
    });
    expect(flattened.required.map((item) => item.id)).toEqual(['gitlab', 'workflow']);
    expect(flattened.defaults).toEqual({
      ui: { language: 'zh-CN', density: 'comfortable' },
    });
  });

  it('does not allow overrides to remove required capabilities', () => {
    const flattened = flattenRole(frontendRole, {
      get: () => baseRole,
    });
    const overrides: ProfileOverrides = {
      add: [],
      remove: ['gitlab', 'playwright'],
      disable: [],
      configuration: {},
      permissions: [],
    };
    const result = applyOverrides(flattened, [overrides]);
    expect(result.required.some((item) => item.id === 'gitlab')).toBe(true);
    expect(result.recommended.some((item) => item.id === 'playwright')).toBe(false);
  });

  it('detects inheritance cycles', () => {
    const cycle = { ...baseRole, extends: ['base-developer'] };
    expect(() => flattenRole(cycle, { get: () => cycle })).toThrow(/cycle/i);
  });
});

describe('dependency resolver', () => {
  it('installs dependencies before dependents and records reasons', () => {
    const role = flattenRole(frontendRole, { get: () => baseRole });
    const catalog = new Map<string, Capability>([
      ['gitlab', capability('gitlab', [version('1.2.0')])],
      [
        'workflow',
        capability('workflow', [
          version('2.1.0', [
            { id: 'playwright', range: '^1.0.0', optional: false, reason: 'test workflow' },
          ]),
        ]),
      ],
      ['playwright', capability('playwright', [version('1.4.0')])],
    ]);
    const result = resolveCapabilities(role, { get: (id) => catalog.get(id) });
    expect(result.installationOrder.indexOf('playwright')).toBeLessThan(
      result.installationOrder.indexOf('workflow'),
    );
    expect(result.capabilities.find((item) => item.id === 'playwright')?.reason).toContain(
      'dependency:workflow',
    );
  });

  it('rejects a required and denied capability', () => {
    const role = flattenRole(
      {
        ...frontendRole,
        capabilities: { ...frontendRole.capabilities, denied: ['workflow'] },
      },
      { get: () => baseRole },
    );
    expect(() =>
      resolveCapabilities(role, {
        get: (id) => capability(id, [version('2.1.0')]),
      }),
    ).toThrow(HarnessError);
  });

  it('includes an explicitly selected optional capability and preserves disabled state', () => {
    const role = flattenRole(frontendRole, { get: () => baseRole });
    const catalog = new Map<string, Capability>([
      ['gitlab', capability('gitlab', [version('1.2.0')])],
      ['workflow', capability('workflow', [version('2.1.0')])],
      ['playwright', capability('playwright', [version('1.4.0')])],
      ['database', capability('database', [version('2026.08')])],
    ]);
    const result = resolveCapabilities(
      role,
      { get: (id) => catalog.get(id) },
      {
        includeOptional: ['database'],
        disabled: ['database'],
      },
    );
    expect(result.capabilities.find((item) => item.id === 'database')).toMatchObject({
      version: '2026.08',
      enabled: false,
    });
    expect(() =>
      resolveCapabilities(role, { get: (id) => catalog.get(id) }, { includeOptional: ['unknown'] }),
    ).toThrow(/not an optional capability/);
  });

  it('reports missing, disabled and incompatible capabilities as domain errors', () => {
    const role = flattenRole(frontendRole, { get: () => baseRole });
    expect(() => resolveCapabilities(role, { get: () => undefined })).toThrow(/not available/);
    expect(() =>
      resolveCapabilities(role, {
        get: (id) => ({ ...capability(id, [version('1.0.0')]), status: 'disabled' }),
      }),
    ).toThrow(/not available/);
    expect(() =>
      resolveCapabilities(role, {
        get: (id) => capability(id, [version('9.0.0')]),
      }),
    ).toThrow(/No version/);
  });

  it('detects version conflicts, declared conflicts and dependency cycles', () => {
    const sharedV1 = version('1.0.0');
    const sharedV2 = version('2.0.0');
    const role = {
      ...flattenRole(frontendRole, { get: () => baseRole }),
      required: [
        { id: 'a', range: '*', reason: 'a', configuration: {} },
        { id: 'b', range: '*', reason: 'b', configuration: {} },
      ],
      recommended: [],
    };
    const versionConflict = new Map<string, Capability>([
      [
        'a',
        capability('a', [
          version('1.0.0', [{ id: 'shared', range: '^1', optional: false, reason: 'shared v1' }]),
        ]),
      ],
      [
        'b',
        capability('b', [
          version('1.0.0', [{ id: 'shared', range: '^2', optional: false, reason: 'shared v2' }]),
        ]),
      ],
      ['shared', capability('shared', [sharedV1, sharedV2])],
    ]);
    expect(() => resolveCapabilities(role, { get: (id) => versionConflict.get(id) })).toThrow(
      /No single version/,
    );

    const conflicting = new Map<string, Capability>([
      [
        'a',
        capability('a', [
          { ...version('1.0.0'), conflicts: [{ id: 'b', range: '*', reason: 'exclusive' }] },
        ]),
      ],
      ['b', capability('b', [version('1.0.0')])],
    ]);
    expect(() => resolveCapabilities(role, { get: (id) => conflicting.get(id) })).toThrow(
      /conflicts with/,
    );

    const cyclic = new Map<string, Capability>([
      [
        'a',
        capability('a', [
          version('1.0.0', [{ id: 'b', range: '*', optional: false, reason: 'cycle' }]),
        ]),
      ],
      [
        'b',
        capability('b', [
          version('1.0.0', [{ id: 'a', range: '*', optional: false, reason: 'cycle' }]),
        ]),
      ],
    ]);
    expect(() => resolveCapabilities(role, { get: (id) => cyclic.get(id) })).toThrow(
      /Dependency cycle/,
    );
  });

  it('deduplicates warnings for optional, deprecated and review-required capabilities', () => {
    const role = {
      ...flattenRole(frontendRole, { get: () => baseRole }),
      required: [{ id: 'legacy', range: '*', reason: 'legacy', configuration: {} }],
      recommended: [{ id: 'review', range: '*', reason: 'review', configuration: {} }],
    };
    const legacy = {
      ...capability('legacy', [
        version('1.0.0', [{ id: 'helper', range: '*', optional: true, reason: 'optional helper' }]),
      ]),
      status: 'deprecated' as const,
    };
    const review = {
      ...capability('review', [version('snapshot')]),
      status: 'needs-review' as const,
    };
    const result = resolveCapabilities(role, {
      get: (id) => (id === 'legacy' ? legacy : id === 'review' ? review : undefined),
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Optional dependency helper'),
        'legacy is deprecated',
        'review needs metadata review',
      ]),
    );
  });
});

describe('execution planner', () => {
  it('creates install, update, remove and runtime configuration operations', () => {
    const identity = {
      deploymentId: 'internal-a',
      runtimeId: 'claude-code',
      scope: 'user' as const,
    };
    const desiredBase = {
      identity,
      roleId: 'frontend',
      roleVersion: '1.0.0',
      capabilities: [
        { id: 'jira', version: '2.0.0', reason: ['role'], enabled: true, configuration: {} },
        { id: 'wiki', version: '1.0.0', reason: ['role'], enabled: true, configuration: {} },
      ],
      permissions: [],
      overrides: { add: [], remove: [], disable: [], configuration: {}, permissions: [] },
    };
    const desired: DesiredState = { ...desiredBase, checksum: checksumOf(desiredBase) };
    const actual: ActualState = {
      identity,
      installed: [
        {
          id: 'jira',
          version: '1.0.0',
          enabled: true,
          sourceId: 'npm',
          installedAt: new Date(0).toISOString(),
          storePath: 'store/jira',
        },
        {
          id: 'legacy',
          version: '1.0.0',
          enabled: true,
          sourceId: 'npm',
          installedAt: new Date(0).toISOString(),
          storePath: 'store/legacy',
        },
      ],
      managedFiles: [],
      observedAt: new Date(0).toISOString(),
    };
    const plan = createExecutionPlan(desired, actual, {
      catalogChecksum: 'b'.repeat(64),
      id: 'plan-test',
      now: new Date(0),
    });
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      'update-capability',
      'install-capability',
      'remove-capability',
      'write-runtime-config',
    ]);
  });

  it('rewrites runtime configuration when only Desired permissions changed', () => {
    const identity = {
      deploymentId: 'internal-a',
      runtimeId: 'claude-code',
      scope: 'user' as const,
    };
    const base = {
      identity,
      roleId: 'frontend',
      roleVersion: '1.0.0',
      capabilities: [],
      permissions: [],
      overrides: { add: [], remove: [], disable: [], configuration: {}, permissions: [] },
    };
    const desired: DesiredState = { ...base, checksum: checksumOf(base) };
    const actual: ActualState = {
      identity,
      installed: [],
      appliedDesiredChecksum: 'a'.repeat(64),
      managedFiles: [],
      observedAt: new Date(0).toISOString(),
    };
    const plan = createExecutionPlan(desired, actual, { catalogChecksum: 'b'.repeat(64) });
    expect(plan.operations.map((item) => item.type)).toEqual(['write-runtime-config']);
  });

  it('plans enable and disable changes and rejects a mismatched identity', () => {
    const identity = { deploymentId: 'a', runtimeId: 'claude-code', scope: 'user' as const };
    const desiredBase = {
      identity,
      roleId: 'role',
      roleVersion: '1.0.0',
      capabilities: [
        { id: 'enable-me', version: '1.0.0', reason: [], enabled: true, configuration: {} },
        { id: 'disable-me', version: '1.0.0', reason: [], enabled: false, configuration: {} },
      ],
      permissions: [],
      overrides: { add: [], remove: [], disable: [], configuration: {}, permissions: [] },
    };
    const desired: DesiredState = { ...desiredBase, checksum: checksumOf(desiredBase) };
    const actual: ActualState = {
      identity,
      installed: [
        {
          id: 'enable-me',
          version: '1.0.0',
          enabled: false,
          sourceId: 'x',
          installedAt: '',
          storePath: '',
        },
        {
          id: 'disable-me',
          version: '1.0.0',
          enabled: true,
          sourceId: 'x',
          installedAt: '',
          storePath: '',
        },
      ],
      managedFiles: [],
      observedAt: '',
    };
    expect(
      createExecutionPlan(desired, actual, { catalogChecksum: 'x' }).operations.map(
        (item) => item.type,
      ),
    ).toEqual(['enable-capability', 'disable-capability', 'write-runtime-config']);
    expect(() =>
      createExecutionPlan(
        desired,
        {
          ...actual,
          identity: { ...identity, deploymentId: 'other' },
        },
        { catalogChecksum: 'x' },
      ),
    ).toThrow(/identities do not match/);
  });
});

describe('profile overrides', () => {
  it('keeps project capability configuration while applying a role', () => {
    const flattened = flattenRole(frontendRole, { get: () => baseRole });
    const overridden = applyOverrides(flattened, [
      {
        add: [],
        remove: [],
        disable: [],
        configuration: { workflow: { project: 'NOVA' } },
        permissions: [],
      },
    ]);
    expect(overridden.required.find((item) => item.id === 'workflow')?.configuration).toEqual({
      project: 'NOVA',
    });
  });

  it('rejects a missing parent and preserves enforced stricter permissions', () => {
    expect(() => flattenRole(frontendRole, { get: () => undefined })).toThrow(/Parent role/);
    const enforcedBase = {
      ...baseRole,
      runtime: { ...baseRole.runtime, defaultAgent: 'reviewer' },
      permissions: [{ ...baseRole.permissions[0]!, effect: 'deny' as const, enforced: true }],
    };
    const child = {
      ...frontendRole,
      permissions: [{ ...baseRole.permissions[0]!, effect: 'allow' as const, enforced: false }],
    };
    const flattened = flattenRole(child, { get: () => enforcedBase });
    expect(flattened.defaultAgent).toBeUndefined();
    expect(flattened.permissions.find((item) => item.id === 'git-read')?.effect).toBe('deny');
    const overridden = applyOverrides(flattened, [
      {
        add: [
          { id: 'extra', range: '*', reason: 'manual', configuration: {} },
          { id: 'production-db', range: '*', reason: 'blocked', configuration: {} },
        ],
        remove: [],
        disable: [],
        configuration: {},
        permissions: [{ ...baseRole.permissions[0]!, effect: 'allow', enforced: false }],
      },
    ]);
    expect(overridden.recommended.some((item) => item.id === 'extra')).toBe(true);
    expect(overridden.recommended.some((item) => item.id === 'production-db')).toBe(false);
    expect(overridden.permissions.find((item) => item.id === 'git-read')?.effect).toBe('deny');
  });
});
