import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CatalogQueryDto } from './catalog-query.dto.js';
import { CatalogService } from './catalog.service.js';

/** 提供统一能力目录、版本、依赖与兼容性只读 API。 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('catalog')
  list(@Query() query: CatalogQueryDto) {
    return this.catalog.list(query);
  }

  @Get('catalog/search')
  search(@Query() query: CatalogQueryDto) {
    return this.catalog.list(query);
  }

  @Get('capabilities/:id')
  get(@Param('id') id: string) {
    return this.catalog.get(id);
  }

  @Get('capabilities/:id/versions')
  versions(@Param('id') id: string) {
    return this.catalog.versions(id);
  }

  @Get('capabilities/:id/dependencies')
  dependencies(@Param('id') id: string) {
    return this.catalog.dependencies(id);
  }

  @Get('capabilities/:id/compatibility')
  compatibility(@Param('id') id: string) {
    return this.catalog.compatibility(id);
  }
}
