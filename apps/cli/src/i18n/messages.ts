/** CLI 可本地化文案键。业务对象数据不翻译，保证 JSON 输出跨语言稳定。 */
export const messages = {
  'zh-CN': {
    nextStep: '下一步',
    unknownError: '未知错误',
    cancelled: '操作已取消',
  },
  'en-US': {
    nextStep: 'Next step',
    unknownError: 'Unknown error',
    cancelled: 'Operation cancelled',
  },
} as const;

/** CLI 当前支持的语言标识类型。 */
export type Locale = keyof typeof messages;
/** 所有语言包必须共同实现的稳定文案键。 */
export type MessageKey = keyof (typeof messages)['zh-CN'];

/** 按 locale 返回文案；缺失 locale 时回退到默认中文。 */
export function translate(locale: Locale | undefined, key: MessageKey): string {
  return messages[locale ?? 'zh-CN'][key];
}
