# 故障排查 — dsh-rfq-compare

每条按「症状 / 原因 / 动作」写。报错原文都是 `<一句人话>（E_XXX）｜下一步：<动作>`；
把 `E_XXX` 和这句话一起发到 issue 即可定位。不要把真实供应商报价或客户价格贴进 issue。

## 1. 报价表是空的（E_RFQ_EMPTY）

- **症状**：`没有可用的报价行，比价表是空的（E_RFQ_EMPTY）｜下一步：至少导入一条报价...`
- **原因**：CSV 只有表头没有数据行；或者 `rfq_ingest` 既没传 `csv_text` 也没传 `quotes`；或者在空表上直接跑了 `rfq_compare` / `rfq_export`。
- **动作**：确认 CSV 表头下面至少有一行报价；先 `rfq_ingest` 再 `rfq_compare`；换文件后重新导入。

## 2. 数量不合法（E_RFQ_QTY）

- **症状**：`报价数量必须是大于 0 的整数（E_RFQ_QTY）｜下一步：把 qty 改成 1、10、100 这样的正整数...`
- **原因**：`qty` 写了 `0`、负数、`1.5`、空字符串或非数字。
- **动作**：一个物料要按件/套/台报整数数量；如果上游按重量或长度报价，先换算成同一计量单位的整数，再导入。

## 3. 币种不支持（E_RFQ_CURRENCY）

- **症状**：`币种不在支持范围（E_RFQ_CURRENCY）｜下一步：只使用 CNY、USD、EUR 三种币种...`
- **原因**：`currency` 写了 `GBP`、`JPY`、`RMB`、`$` 等；`fx_rates` 里出现了未知币种键。
- **动作**：只写 `CNY` / `USD` / `EUR`；其它币种先按当天汇率折算成这三种之一，并在 `note` 里注明原始币种与汇率来源。

## 4. 单价不是整数分（E_RFQ_PRICE）

- **症状**：`单价必须用整数分表示，且大于 0（E_RFQ_PRICE）｜下一步：把 12.34 元写成 1234（分）...`
- **原因**：`unit_price_cents` 写了小数、负数或 0；或者 `unit_price` 超过两位小数（如 `12.345`）。
- **动作**：优先用 `unit_price_cents` 写整数分；用 `unit_price` 时最多两位小数。不要四舍五入到“元”，否则价差会失真。

## 5. 日期不合法（E_RFQ_DATE）

- **症状**：`有效期不是合法日期（E_RFQ_DATE）｜下一步：把 valid_until 写成 YYYY-MM-DD...`
- **原因**：`valid_until` 写成 `2026/12/31`、`2026-13-01`、`2026-02-30`，或 `as_of` 不是真实日期。
- **动作**：统一 `YYYY-MM-DD`；2 月 30 日这类“格式对但日历不存在”的日期也会被拒绝。

## 6. CSV 读不懂（E_RFQ_CSV）

- **症状**：`这份报价 CSV 读不懂：表头缺列、列数对不上或引号没有闭合（E_RFQ_CSV）｜下一步：表头至少要有...`
- **原因**：缺 `supplier` / `material` / `qty` / `currency` / `lead_time_days` / `valid_until`；金额列两个都没给；表头有重复列名；某行列数比表头多；引号没有闭合。
- **动作**：对照样例表头；用 Excel “另存为 CSV UTF-8” 重新导出；备注里有逗号时整体加双引号，内部双引号写成两个双引号。

## 7. 导出文件名不安全（E_RFQ_PATH_INVALID / E_RFQ_PATH_NOT_ALLOWED）

- **症状**：`导出路径越过了导出目录（E_RFQ_PATH_NOT_ALLOWED）｜下一步：只传一个文件名...`
- **原因**：`filename` 里带了 `../`、`/`、反斜杠、空格、中文或超长路径；或解析后的路径跳出了 `exports/`。
- **动作**：只传一个 `[A-Za-z0-9._-]` 组成的文件名，例如 `rfq-compare.csv`；不要传绝对路径。目录固定为 `$DSH_HOME/dsh-rfq-compare/exports/`。

## 8. CSV 写不出去（E_RFQ_EXPORT_FAILED）

- **症状**：`比价 CSV 没写出去（E_RFQ_EXPORT_FAILED）｜下一步：确认 $DSH_HOME/dsh-rfq-compare 指向可写目录后重试`
- **原因**：`$DSH_HOME` 不存在、只读、磁盘满，或当前进程没有写权限。
- **动作**：确认 `$DSH_HOME` 指向可写目录（或测试时设 `DSH_RFQ_COMPARE_HOME` 到临时目录），再重试；不要用删除用户数据的方式“修复”。

## 9. 汇率覆盖值不合法（E_RFQ_FX）

- **症状**：`汇率覆盖值不合法（E_RFQ_FX）｜下一步：fx_rates 里每个币种给一个大于 0 的数字...`
- **原因**：`fx_rates` 里给了 0、负数、`"abc"`，或者整个值不是对象。
- **动作**：写 `{"USD": 7.25, "EUR": 7.82}` 这种“1 单位外币 = 多少 CNY”的正数；不传就用占位汇率。

## 还不行

```sh
node samples/quickstart/run.mjs --check   # 自带样例必须通过
node --test test/*.test.mjs               # 36 项测试
node scripts/gate.mjs                     # 元数据 + 验收门
```

仍失败时请在 <https://github.com/PerryLink/dsh-rfq-compare/issues> 附上：包版本、最小合成 CSV（或生成脚本）、
`rfq_ingest` / `rfq_compare` 的完整报错行、Node 与 DSH 版本。**不要附真实供应商报价或客户价格。**
