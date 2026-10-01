import type { TabletPackage } from '../domain'

const dayTourId = 'FT-260929-D'

/**
 * 离线平板演示包。
 * PKG-0929-T1：巡检班长平板在坝顶联络路封闭后离线改了主坝、库区路线，
 *   新增下游背坡绕行线，完成 S01，并上传 W01 异常的现场复核、尝试认领责任人。
 * PKG-0929-T2：值班室另一台平板离线期间也改过库区同一点 W01（baseVersion 同为 1），
 *   合并时与 T1 构成“两边都改”，保留两版待值班室确认。
 * PKG-0929-T3：引用不存在的班次，导入必失败；重试同一包不得多出班次。
 */
export const demoTabletPackages: TabletPackage[] = [
  {
    id: 'PKG-0929-T1',
    tabletId: 'TAB-PATROL-01',
    tourId: dayTourId,
    operator: '巡检班长 高鹏',
    packedAt: '2026-09-29T09:30:00',
    newSegments: [
      { id: 'SG-DETOUR-A', name: '下游背坡绕行线', kind: '绕行段' }
    ],
    assignmentEdits: [
      { pointId: 'P-D02', segmentId: 'SG-DETOUR-A', basis: '绕行段', baseVersion: 1, editedAt: '2026-09-29T08:55:00', reason: '坝顶联络路封闭，主坝未完成点改走背坡绕行' },
      { pointId: 'P-S01', segmentId: 'SG-DETOUR-A', basis: '绕行段', baseVersion: 1, editedAt: '2026-09-29T09:00:00', reason: '渗流计沿背坡绕行可达' },
      { pointId: 'P-W01', segmentId: 'SG-DETOUR-A', basis: '绕行段', baseVersion: 1, editedAt: '2026-09-29T09:05:00', reason: '库区点经背坡绕行线接近' }
    ],
    completions: [
      { pointId: 'P-S01', completedAt: '2026-09-29T10:05:00', inspector: '高鹏', note: '绕行至背坡完成渗流计检查，读数1.7L/s' }
    ],
    fieldReviews: [
      {
        anomalyId: 'AN-260929-02',
        review: { id: 'FR-OFF-1', inspector: '高鹏', arrivedAt: '2026-09-29T09:50:00', observed: '泄洪闸开度正常，库水位涨势趋缓，岸坡未见新增渗流出逸点。', evidence: '闸口照片、入库流量人工记录', reassessment: '读数有效，维持每小时加密监测，暂不升级。', version: 0 }
      }
    ],
    ownerClaims: [
      { anomalyId: 'AN-260929-02', owner: '离线巡查临时组', reason: '离线平板尝试改派异常责任人' }
    ]
  },
  {
    id: 'PKG-0929-T2',
    tabletId: 'TAB-OFFICE-02',
    tourId: dayTourId,
    operator: '值班员 林珊',
    packedAt: '2026-09-29T09:45:00',
    newSegments: [
      { id: 'SG-DETOUR-B', name: '库尾高线绕行线', kind: '绕行段' }
    ],
    assignmentEdits: [
      { pointId: 'P-W01', segmentId: 'SG-DETOUR-B', basis: '绕行段', baseVersion: 1, editedAt: '2026-09-29T09:12:00', reason: '库尾高线绕行线更安全，避开塌方沟口' }
    ],
    completions: [],
    fieldReviews: [],
    ownerClaims: []
  },
  {
    id: 'PKG-0929-T3',
    tabletId: 'TAB-PATROL-01',
    tourId: 'FT-260929-X',
    operator: '巡检班长 高鹏',
    packedAt: '2026-09-29T11:20:00',
    assignmentEdits: [],
    completions: [],
    fieldReviews: [],
    ownerClaims: []
  },
  {
    // 现场直接开出的夜班；首次导入建班，再次导入必须幂等、不重复建班
    id: 'PKG-0929-T4',
    tabletId: 'TAB-PATROL-01',
    tourId: 'FT-260929-N',
    operator: '夜巡班 赵岭',
    packedAt: '2026-09-29T20:10:00',
    newTour: {
      id: 'FT-260929-N',
      name: '9月29日夜班汛期巡检',
      season: '2026汛期',
      startedAt: '2026-09-29T20:00:00',
      expectedPointIds: ['P-D01', 'P-D02', 'P-W01'],
      segments: [
        { id: 'SG-N-MAIN', name: '夜班主坝段', kind: '计划段' },
        { id: 'SG-N-LAKE', name: '夜班库区段', kind: '计划段' }
      ]
    },
    assignmentEdits: [],
    completions: [],
    fieldReviews: [],
    ownerClaims: []
  }
]
