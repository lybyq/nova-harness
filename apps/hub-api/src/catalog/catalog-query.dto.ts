import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Catalog 的分页、模糊搜索、角色、标签和 Runtime 过滤参数。 */
export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['mcp', 'skill', 'plugin', 'agent', 'hook', 'policy', 'pack'])
  type?: string;

  @IsOptional()
  @IsIn(['active', 'deprecated', 'disabled', 'experimental', 'needs-review'])
  status?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  runtime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
