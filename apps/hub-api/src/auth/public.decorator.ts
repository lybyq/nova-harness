import { SetMetadata } from '@nestjs/common';

/** Reflector 读取的公开路由元数据键。 */
export const PUBLIC_ROUTE = 'nova:public-route';
/** 将健康检查等端点标为无需 Bearer 鉴权。 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
