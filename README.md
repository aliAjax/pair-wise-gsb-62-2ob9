# 矿山尾矿库监测计划与异常处置审阅平台

基于Angular、Angular Material、NgRx、Angular Router、RxJS、HttpClient、MapLibre GL、Turf.js、Nx和TypeScript的独立前端工程。无后端时自动使用本地模拟数据，界面内操作保留版本和审计。

## 功能

- 位移、水位、渗流、降雨监测点，MapLibre测点图层和Turf巡检路线长度。
- 汛期巡检班次、唯一路线段归属、暴雨封路绕行、封路解除接管和离线平板冲突双版本确认。
- 离线包按包ID幂等导入；导入失败事务回滚，重试不会新增班次或重复改线。
- 看板、异常详情与JSON审阅包共用同一覆盖范围计算。
- 报警值、变化速率与阈值版本查看。
- 异常队列、现场复核、证据、复测评估和专业异议并存。
- 处置方案、重大异常应急联动、负责人审批和关闭条件校验。
- 原始读数只读，所有修订形成独立版本和审计时间线。
- JSON审阅包导出。

端口为`18462`。

```bash
npm install
npm run build
npm run dev
```
