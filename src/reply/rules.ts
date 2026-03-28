/**
 * 默认回复规则
 * 可在 data/reply-config.json 中自定义
 */

import { ReplyRule } from './engine';

export function getDefaultRules(): ReplyRule[] {
  return [
    // ============ 问候类 ============
    {
      id: 'greeting-hi',
      name: '打招呼-你好',
      keywords: ['你好', '您好', '在吗', 'hello', 'hi', '在么', '在不', '你好呀', '你好啊'],
      reply: '您好！欢迎光临~ 请问有什么可以帮到您的呢？',
      priority: 10,
      enabled: true
    },
    {
      id: 'greeting-morning',
      name: '打招呼-早上好',
      keywords: ['早上好', '上午好', '早安'],
      reply: '早上好！新的一天祝您购物愉快~ 有什么需要帮您的吗？',
      priority: 10,
      enabled: true
    },
    {
      id: 'greeting-evening',
      name: '打招呼-晚上好',
      keywords: ['晚上好', '晚安'],
      reply: '晚上好！夜深了，注意休息哦~ 有什么可以帮您的吗？',
      priority: 10,
      enabled: true
    },

    // ============ 询价类 ============
    {
      id: 'price-query',
      name: '询价-多少钱',
      keywords: ['多少钱', '怎么卖', '价格', '多少米', '报价', '卖多少', '价格多少'],
      reply: '您好亲，具体价格根据您选择的规格有所不同哦~ 您看中的是哪款产品呢？我帮您查一下具体价格~',
      priority: 20,
      enabled: true
    },
    {
      id: 'price-cheap',
      name: '询价-便宜点',
      keywords: ['便宜', '优惠', '折扣', '降价', '便宜点', '少点', '能便宜吗', '打几折'],
      reply: '亲，我们已经是微利价格了呢~ 不过您下单后我可以帮您申请一张优惠券哦！您先拍下，我来帮您操作~',
      priority: 20,
      enabled: true
    },

    // ============ 规格类 ============
    {
      id: 'spec-query',
      name: '规格-尺寸颜色',
      keywords: ['尺寸', '大小', '颜色', '规格', '多长', '多宽', '多高', 'cm', '多大', '什么颜色'],
      reply: '亲，您好~ 请问您想了解的是哪款产品的具体尺寸呢？不同款式规格不一样的哦~',
      priority: 15,
      enabled: true
    },
    {
      id: 'stock-query',
      name: '库存-有货吗',
      keywords: ['有货吗', '库存', '还有吗', '卖完了吗', '缺货', '什么时候有货', '预售'],
      reply: '亲，您看中的这款有货的哦~ 您要什么颜色/规格的呢？我帮您查一下具体库存~',
      priority: 15,
      enabled: true
    },

    // ============ 物流类 ============
    {
      id: 'shipping-query',
      name: '物流-发货',
      keywords: ['发货', '什么时候发', '几天到', '物流', '快递', '发货了吗', '发出没有', '几时发'],
      reply: '亲，下午4点前下单当天发货，4点后次日发货哦~ 默认发顺丰/中通，一般2-3天到达~',
      priority: 15,
      enabled: true
    },
    {
      id: 'shipping-time',
      name: '物流-到货时间',
      keywords: ['几天到', '多久到', '什么时候到', '能到吗', '到货'],
      reply: '亲，正常情况下江浙沪1-2天，其他地区2-4天哦~ 具体还要看物流公司的时效呢~',
      priority: 15,
      enabled: true
    },
    {
      id: 'tracking-query',
      name: '物流-查单号',
      keywords: ['单号', '快递单号', '运单号', '查物流', '物流信息', '到哪里了'],
      reply: '亲，您好~ 请提供一下您的订单号或收货手机尾号，我帮您查询一下物流信息~',
      priority: 15,
      enabled: true
    },

    // ============ 售后类 ============
    {
      id: 'return-query',
      name: '售后-退货',
      keywords: ['退货', '退换', '退款', '不想要了', '退货款', '退钱', '取消订单'],
      reply: '亲，未拆封使用的情况下7天无理由退换货哦~ 请问是什么原因要退货呢？如果是质量问题我们来回运费全包~',
      priority: 25,
      enabled: true
    },
    {
      id: 'exchange-query',
      name: '售后-换货',
      keywords: ['换货', '换一个', '换尺寸', '换颜色', '换款式'],
      reply: '亲，可以的哦~ 请告诉我您想换什么规格的产品呢？我们会安排换货并承担来回运费~',
      priority: 25,
      enabled: true
    },
    {
      id: 'defect-query',
      name: '售后-质量问题',
      keywords: ['坏了', '破损', '质量问题', '有问题', '不能用', '坏了', '瑕疵', '坏掉'],
      reply: '亲，非常抱歉给您带来不便！请您拍一张照片发给我确认一下，我们马上给您处理退换货，来回运费我们承担~',
      priority: 30,
      enabled: true
    },

    // ============ 购买类 ============
    {
      id: 'buy-how',
      name: '购买-怎么买',
      keywords: ['怎么买', '如何购买', '在哪买', '怎么拍', '购买', '下单'],
      reply: '亲，直接点击商品页面右下角的"立即购买"或"加入购物车"就可以哦~ 有什么不懂的步骤我也可以教您~',
      priority: 20,
      enabled: true
    },
    {
      id: ' COD-query',
      name: '购买-货到付款',
      keywords: ['货到付款', '先货后款', '到付'],
      reply: '亲，非常抱歉，本店不支持货到付款哦~ 您可以选择支付宝、微信或银行卡支付，非常方便的~',
      priority: 20,
      enabled: true
    },

    // ============ 感谢类 ============
    {
      id: 'thanks',
      name: '感谢-谢谢',
      keywords: ['谢谢', '感谢', '辛苦了', '好的', '知道了', '明白了', '感谢'],
      reply: '不客气亲~ 如有其他问题随时联系我哦，祝您购物愉快！',
      priority: 5,
      enabled: true
    },
    {
      id: 'bye',
      name: '告别-再见',
      keywords: ['再见', '拜拜', '先走了', '去忙吧', 'bye'],
      reply: '好的亲，有需要随时找我哦~ 祝您生活愉快，再见！',
      priority: 5,
      enabled: true
    },

    // ============ 特殊场景 ============
    {
      id: 'busy',
      name: '忙碌-稍等',
      keywords: ['稍等', '等一下', '等会', '等一下下'],
      reply: '好的亲，您先忙，我这边随时在线等您~ 不着急的哦~',
      priority: 8,
      enabled: true
    },
    {
      id: 'urgent',
      name: '加急-催促',
      keywords: ['加急', '快点', '急', '很急', '马上', '立刻'],
      reply: '亲，我马上帮您催一下仓库尽快发出！请稍等片刻~',
      priority: 25,
      enabled: true
    },
    {
      id: 'complaint',
      name: '投诉-抱怨',
      keywords: ['投诉', '差评', '不满', '态度不好', '要投诉', '差评'],
      reply: '亲，非常抱歉给您带来不愉快的体验！请您告诉我具体是什么情况，我一定会认真处理并给您一个满意的答复~',
      priority: 30,
      enabled: true
    }
  ];
}
