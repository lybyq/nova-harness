import { describe, expect, it } from 'vitest';
import { deploymentProfileSchema } from './deployment.js';

const validProfile = {
  apiVersion: 'harness.nova/v1',
  kind: 'DeploymentProfile',
  metadata: { id: 'public-smoke', displayName: 'Public Smoke' },
  hub: { url: 'http://localhost:3200/api/v1' },
  downloads: { allowedHosts: ['gitlab.com', 'registry.npmjs.org'] },
  sources: [
    {
      id: 'public-npm',
      displayName: 'Public npm',
      type: 'npm',
      registry: 'https://registry.npmjs.org',
      adapter: 'static-index',
      seedPackages: ['@modelcontextprotocol/server-filesystem'],
    },
  ],
  runtime: {},
  trust: {},
};

describe('deploymentProfileSchema', () => {
  it('applies safe defaults', () => {
    const parsed = deploymentProfileSchema.parse(validProfile);
    expect(parsed.network.rejectUnauthorized).toBe(true);
    expect(parsed.sources[0]?.http.retries).toBe(2);
    expect(parsed.trust.allowUnreviewed).toBe(false);
  });

  it('rejects duplicate source ids', () => {
    const duplicate = {
      ...validProfile,
      sources: [validProfile.sources[0], validProfile.sources[0]],
    };
    expect(() => deploymentProfileSchema.parse(duplicate)).toThrow(/duplicate source id/);
  });

  it('never accepts an inline token field', () => {
    const withToken = {
      ...validProfile,
      sources: [{ ...validProfile.sources[0], token: 'secret' }],
    };
    const parsed = deploymentProfileSchema.parse(withToken);
    expect('token' in parsed.sources[0]!).toBe(false);
  });
});
