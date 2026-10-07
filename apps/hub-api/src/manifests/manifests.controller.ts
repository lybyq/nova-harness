import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  capabilitySchema,
  deploymentProfileSchema,
  roleProfileSchema,
} from '@nova-cbb/harness-contracts';
import { checksumOf, HarnessError } from '@nova-cbb/harness-shared';
import { parse } from 'yaml';

/** 对 YAML/JSON Manifest 执行契约校验、规范化预览与确定性校验和计算。 */
@ApiTags('manifests')
@ApiBearerAuth()
@Controller('manifests')
export class ManifestsController {
  @Post('validate') validate(@Body() body: unknown) {
    const value = normalize(body);
    const parsed = selectSchema(value).parse(value);
    return {
      valid: true,
      kind: 'kind' in parsed ? parsed.kind : 'Capability',
      checksum: checksumOf(parsed),
    };
  }
  @Post('preview') preview(@Body() body: unknown) {
    const value = normalize(body);
    return selectSchema(value).parse(value);
  }
}
function normalize(body: unknown): unknown {
  if (isRecord(body) && typeof body.content === 'string') return parse(body.content) as unknown;
  return body;
}
function selectSchema(value: unknown) {
  if (!isRecord(value))
    throw new HarnessError({ code: 'CONFIG_INVALID', message: 'Manifest must be an object' });
  if (value.kind === 'DeploymentProfile') return deploymentProfileSchema;
  if (value.kind === 'RoleProfile') return roleProfileSchema;
  return capabilitySchema;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
