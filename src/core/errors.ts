/** Every user-facing failure is a stable code plus one human sentence and one next action. */
export type RfqErrorCode =
  | 'E_RFQ_EMPTY'
  | 'E_RFQ_CSV'
  | 'E_RFQ_ROW'
  | 'E_RFQ_MATERIAL'
  | 'E_RFQ_QTY'
  | 'E_RFQ_PRICE'
  | 'E_RFQ_CURRENCY'
  | 'E_RFQ_LEAD_TIME'
  | 'E_RFQ_DATE'
  | 'E_RFQ_FX'
  | 'E_RFQ_PATH_INVALID'
  | 'E_RFQ_PATH_NOT_ALLOWED'
  | 'E_RFQ_EXPORT_FAILED'

interface HumanMessage {
  text: string
  next: string
}

const RFQ_HUMAN: Record<RfqErrorCode, HumanMessage> = {
  E_RFQ_EMPTY: {
    text: '没有可用的报价行，比价表是空的',
    next: '至少导入一条报价（CSV 表头下要有数据行），再运行 rfq_compare 或 rfq_export',
  },
  E_RFQ_CSV: {
    text: '这份报价 CSV 读不懂：表头缺列、列数对不上或引号没有闭合',
    next: '表头至少要有 supplier,material,qty,currency,lead_time_days,valid_until，金额列用 unit_price_cents 或 unit_price',
  },
  E_RFQ_ROW: {
    text: '有一条报价缺供应商或物料',
    next: '补齐 supplier 和 material 两列后重试；不要用空行占位',
  },
  E_RFQ_MATERIAL: {
    text: '物料编号是空的',
    next: '每一行报价都要填 material（物料编码或 SKU），不能为空白',
  },
  E_RFQ_QTY: {
    text: '报价数量必须是大于 0 的整数',
    next: '把 qty 改成 1、10、100 这样的正整数；小数或 0 不接受',
  },
  E_RFQ_PRICE: {
    text: '单价必须用整数分表示，且大于 0',
    next: '把 12.34 元写成 1234（分）；unit_price 列也接受最多两位小数，但内部统一换算成整数分',
  },
  E_RFQ_CURRENCY: {
    text: '币种不在支持范围',
    next: '只使用 CNY、USD、EUR 三种币种；其它币种请先换算或补一条映射后再导入',
  },
  E_RFQ_LEAD_TIME: {
    text: '交期必须是大于等于 0 的整数天',
    next: '把 lead_time_days 改成 0、7、14 这样的整数天数',
  },
  E_RFQ_DATE: {
    text: '有效期不是合法日期',
    next: '把 valid_until 写成 YYYY-MM-DD，例如 2026-12-31',
  },
  E_RFQ_FX: {
    text: '汇率覆盖值不合法',
    next: 'fx_rates 里每个币种给一个大于 0 的数字（1 单位外币折合多少 CNY），例如 {"USD": 7.25}',
  },
  E_RFQ_PATH_INVALID: {
    text: '导出文件名不安全',
    next: '只传一个文件名，例如 rfq-compare.csv；不要带目录分隔符、空格或中文',
  },
  E_RFQ_PATH_NOT_ALLOWED: {
    text: '导出路径越过了导出目录',
    next: '只传一个文件名，不要带 ../、目录分隔符或符号链接',
  },
  E_RFQ_EXPORT_FAILED: {
    text: '比价 CSV 没写出去',
    next: '确认 $DSH_HOME/dsh-rfq-compare 指向可写目录后重试',
  },
}

/** `human sentence（E_CODE）｜Next: one action｜detail` — the only text shown to end users. */
export function rfqErrorMessage(code: RfqErrorCode, detail?: string): string {
  const human = RFQ_HUMAN[code]
  return `${human.text}（${code}）｜下一步：${human.next}${detail ? `｜细节：${detail}` : ''}`
}

export class RfqError extends Error {
  readonly code: RfqErrorCode
  constructor(code: RfqErrorCode, detail?: string) {
    super(rfqErrorMessage(code, detail))
    this.name = 'RfqError'
    this.code = code
  }
}
