import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeProject, projectStatus, unlinkProject } from './project.js';

describe('项目级 Profile', () => {
  it('完成初始化、读取和幂等解除关联', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nova-project-'));
    const initialized = await initializeProject(root, 'frontend');
    expect(initialized.commitRecommended).toContain('.nova/profile.yaml');
    expect((await projectStatus(root)).profile.extends).toEqual(['roles/frontend']);
    await unlinkProject(root);
    await unlinkProject(root);
  });
});
