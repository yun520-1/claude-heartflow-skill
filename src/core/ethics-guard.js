/**
 * Ethics Guard v2.1.0 - "真善美"多维伦理对齐层
 *
 * v2.1.0 升级（伦理方向）：
 * - 多利益相关者伦理推理：考虑答案对不同相关方的影响
 * - 语境感知评分：整合 CounterfactualEngine 反方分析增强评价
 * - 精细化真值评估：区分事实断言、观点推测、价值判断
 * - 善的维度扩展：自主性、赋能、长期影响、公平性
 * - 美作为清晰度：评估逻辑流、可读性、简洁性
 * - 反馈学习：根据用户偏好动态调整阈值和权重
 *
 * 核心原理：真正的伦理不是规则列表，而是多维度的平衡。
 * 真（认知维度）→ 善（伦理维度）→ 美（审美维度）
 */

class EthicsGuard {
  constructor(options = {}) {
    this.threshold = options.threshold || 24;  // 总分阈值（默认24/30）
    this.minDimensionScore = options.minDimensionScore || 5; // 单维最低分
    this.history = [];
    this.maxHistorySize = options.maxHistorySize || 200;

    // [v2.1.0] 可配置的维度权重
    this.weights = {
      truth: options.truthWeight || 1.0,
      goodness: options.goodnessWeight || 1.0,
      beauty: options.beautyWeight || 1.0,
    };

    // [v2.1.0] 自适应学习状态（根据用户反馈调整）
    this.adaptiveState = {
      enabled: options.enableAdaptive !== false,
      feedbackCount: 0,
      recentAdjustments: [],  // 最近的调整记录
      userPreference: {
        strictness: options.strictness || 'normal',  // relaxed | normal | strict
        emphasizeAutonomy: false,
        emphasizeEmpowerment: false,
      },
    };

    // [v2.1.0] 反方引擎引用（可选集成）
    this._counterfactualEngine = null;

    // [v2.1.0] 利益相关者类别
    this.stakeholderTypes = [
      { id: 'user', label: '用户', active: true, weight: 1.0 },
      { id: 'others', label: '其他受影响者', active: true, weight: 0.7 },
      { id: 'society', label: '社会/群体', active: true, weight: 0.5 },
      { id: 'system', label: '系统/平台', active: false, weight: 0.3 },
    ];
  }

  /**
   * [v2.1.0] 绑定反方引擎
   * 使伦理审查能利用反事实分析增强真值评估
   */
  bindCounterfactual(engine) {
    this._counterfactualEngine = engine;
  }

  // ════════════════════════════════════════════════════════════
  // 核心API
  // ════════════════════════════════════════════════════════════

  /**
   * 整体对齐检查
   */
  holisticAlignment(candidateAnswer, context = {}) {
    var startTime = Date.now();

    var scores = {
      truth: this.evaluateTruth(candidateAnswer, context),
      goodness: this.evaluateGoodness(candidateAnswer, context),
      beauty: this.evaluateBeauty(candidateAnswer, context),
    };

    var totalScore = scores.truth.score * this.weights.truth
                   + scores.goodness.score * this.weights.goodness
                   + scores.beauty.score * this.weights.beauty;

    // 所有维度必须超过最低分
    var allAboveMin = scores.truth.score >= this.minDimensionScore
                   && scores.goodness.score >= this.minDimensionScore
                   && scores.beauty.score >= this.minDimensionScore;
    var passed = allAboveMin && totalScore >= this.threshold;

    // [v2.1.0] 利益相关者影响分析
    var stakeholderImpact = this.analyzeStakeholderImpact(candidateAnswer, context);

    var result = {
      timestamp: new Date().toISOString(),
      scores: scores,
      totalScore: Math.round(totalScore * 100) / 100,
      threshold: this.threshold,
      passed: passed,
      context: context,
      rejected: !passed,
      rejectionReason: passed ? null : this.getRejectionReason(scores),
      stakeholderImpact: stakeholderImpact,
      _meta: { elapsedMs: Date.now() - startTime },
    };

    this.history.push(result);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 维度一：真（认知维度）
  // ════════════════════════════════════════════════════════════

  /**
   * [v2.1.0] 精细化真值评估
   * 区分事实断言、观点推测、价值判断三类陈述的质量
   */
  evaluateTruth(answer, context) {
    var score = 7;
    var details = [];
    var breakdown = {
      factualClaims: 0,
      speculativeStatements: 0,
      valueJudgments: 0,
    };

    if (!answer || answer.length === 0) {
      score -= 3;
      details.push('回答为空');
      return { dimension: '真', score: Math.max(1, Math.min(10, score)), details: details, summary: '无内容可评估' };
    }

    // 1. 检测事实断言及其质量
    var factPatterns = answer.match(/(数据|研究|统计|调查|实验|百分之\d+|\d+%|比例|概率|结果表明|根据.*研究|证实|证明)/g);
    if (factPatterns) {
      breakdown.factualClaims = factPatterns.length;
      score += Math.min(breakdown.factualClaims * 0.3, 1.5); // 有数据支撑加分
      details.push('包含' + breakdown.factualClaims + '个事实性陈述');
    }

    // 2. 检测观点推测（软性陈述）
    var speculativePatterns = answer.match(/(我认为|我觉得|可能|也许|或许|大概|推测|猜测|估计|似乎|看起来|貌似|possibly|probably|might|may|seems)/gi);
    if (speculativePatterns) {
      breakdown.speculativeStatements = speculativePatterns.length;
      // 正确的态度：标注不确定性不扣分，但不标注扣分
      if (speculativePatterns.length > 0) {
        score += 0.2; // 体现元认知是好习惯
        details.push('标注了' + speculativePatterns.length + '处不确定性');
      }
    }

    // 3. 检测价值判断（隐含立场）
    var valuePatterns = answer.match(/(好|坏|对|错|应该|不应该|重要|不重要|必要|不必要|���确|错误|right|wrong|should|shouldn't|important)/gi);
    if (valuePatterns) {
      breakdown.valueJudgments = valuePatterns.length;
      if (valuePatterns.length > 3 && !speculativePatterns) {
        score -= 1; // 大量价值判断但没有标注不确定性
        details.push('包含' + valuePatterns.length + '个价值判断，建议标注主观性');
      } else {
        details.push('包含' + valuePatterns.length + '个价值判断（已标注不确定性）');
      }
    }

    // 4. 确定性信号检测（过度自信）
    var overCertainty = answer.match(/(绝对|必然|一定|肯定|毫无疑问|无可置疑|不容置疑|唯一|永远|从不|always|never|absolutely|certainly)/gi);
    if (overCertainty) {
      var penalty = Math.min(overCertainty.length * 0.5, 2);
      score -= penalty;
      details.push('存在' + overCertainty.length + '处过度确定性表达（-'+ penalty + '）');
    }

    // 5. [v2.1.0] 反方引擎集成：如果有反方分析，用它增强真值评估
    if (this._counterfactualEngine && answer.length > 30) {
      var cfResult = this._counterfactualEngine.analyze(answer, context);
      if (cfResult.relevant && cfResult.opposingViews.length > 0) {
        details.push('反方引擎发现' + cfResult.opposingViews.length + '个可质疑点');
        if (cfResult.evidenceScore && cfResult.evidenceScore.score < 0.5) {
          score -= 1;
          details.push('证据评分偏低(' + cfResult.evidenceScore.score + ')，真值评估下调');
        }
      }
    }

    // 6. 事实来源检查
    if (/研究表明?|研究显示|专家说|权威|报告称|报道/.test(answer)) {
      if (!/arXiv|DOI|论文|文献|来源|参考|引用|according to/i.test(answer)) {
        score -= 0.5;
        details.push('引用模糊来源（研究/专家），建议明确出处');
      }
    }

    return {
      dimension: '真',
      score: Math.max(1, Math.min(10, Math.round(score * 10) / 10)),
      details: details,
      breakdown: breakdown,
      summary: score >= 7 ? '事实依据充分，认知描述准确' : (score >= 5 ? '存在一定不确定性' : '事实依据不足'),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 维度二：善（伦理维度）
  // ════════════════════════════════════════════════════════════

  /**
   * [v2.1.0] 扩展的善评估
   * 从4个子维度评估：帮助性(helpfulness)、自主性(autonomy)、
   * 赋能性(empowerment)、公平性(fairness)
   */
  evaluateGoodness(answer, context) {
    var score = 7;
    var details = [];
    var subScores = {
      helpfulness: 0,
      autonomy: 0,
      empowerment: 0,
      fairness: 0,
    };

    // 1. 帮助性（帮助用户解决实际问题）
    var helpfulIndicators = ['帮助', '支持', '建议', '可以用', '可以试试', '可能对你有帮助', '参考', '推荐'];
    var helpfulCount = 0;
    for (var h = 0; h < helpfulIndicators.length; h++) {
      if (answer.indexOf(helpfulIndicators[h]) !== -1) {
        helpfulCount++;
      }
    }
    subScores.helpfulness = Math.min(helpfulCount / 2, 1.5);
    if (helpfulCount > 0) {
      score += subScores.helpfulness;
      details.push('包含' + helpfulCount + '个帮助性表达（+' + subScores.helpfulness + '）');
    }

    // 2. 自主性（尊重用户决定权）
    var autonomyIndicators = ['选择权', '决定', '你自己', '你可以根据自己的', '最终决定', '由你', '你说了算', 'up to you', 'your choice', 'decide'];
    var autonomyCount = 0;
    for (var a = 0; a < autonomyIndicators.length; a++) {
      if (answer.indexOf(autonomyIndicators[a]) !== -1) {
        autonomyCount++;
      }
    }
    subScores.autonomy = Math.min(autonomyCount * 0.8, 1.5);
    if (autonomyCount > 0) {
      score += subScores.autonomy;
      details.push('尊重用户自主选择权（+' + subScores.autonomy + '）');
    }

    // 3. 赋能性（让用户变得更强，而非依赖）
    var empowerIndicators = ['学习', '掌握', '理解', '认识', '提升', '自己可以做', '独立', '学会', 'skill', 'learn', 'understand', 'master'];
    var empowerCount = 0;
    for (var e = 0; e < empowerIndicators.length; e++) {
      if (answer.indexOf(empowerIndicators[e]) !== -1) {
        empowerCount++;
      }
    }
    subScores.empowerment = Math.min(empowerCount * 0.5, 1.5);
    if (empowerCount > 0) {
      score += subScores.empowerment;
      details.push('包含赋能性表达（+' + subScores.empowerment + '）');
    }

    // 4. 公平性（避免偏见和歧视）
    var biasPatterns = [
      { pattern: /男人(就是|天生|应该)|女人(就是|天生|应该)/i, label: '性别刻板印象', penalty: 2 },
      { pattern: /年轻人(总是|都|从不)|老年人(总是|都|从不)/i, label: '年龄偏见', penalty: 2 },
      { pattern: /农村人|城里人|底层(人群|人)/i, label: '阶层偏见', penalty: 1.5 },
      { pattern: /这个民族|那个种族/i, label: '种族偏见', penalty: 2 },
    ];
    var totalBiasPenalty = 0;
    for (var b = 0; b < biasPatterns.length; b++) {
      if (biasPatterns[b].pattern.test(answer)) {
        totalBiasPenalty += biasPatterns[b].penalty;
        details.push('检测到' + biasPatterns[b].label + '（-' + biasPatterns[b].penalty + '）');
      }
    }
    score -= totalBiasPenalty;
    subScores.fairness = -totalBiasPenalty;

    // 5. 限制性表达检测
    var restrictiveIndicators = ['你必须', '你不能', '不要', '别', '禁止', '必须', 'must', 'cannot'];
    var restrictCount = 0;
    for (var r = 0; r < restrictiveIndicators.length; r++) {
      if (answer.indexOf(restrictiveIndicators[r]) !== -1) {
        restrictCount++;
      }
    }
    if (restrictCount > 2) {
      score -= (restrictCount - 2) * 0.3;
      details.push('过多限制性表达（-' + (restrictCount - 2) * 0.3 + '）');
    }

    // 6. 长期影响评估
    if (/长期|未来|持续|可持[续续]|长远|长期影响|长远来看|long.?term|sustainable/i.test(answer)) {
      score += 0.5;
      details.push('考虑了长期影响（+0.5）');
    }

    var finalScore = Math.max(1, Math.min(10, score));

    return {
      dimension: '善',
      score: Math.round(finalScore * 10) / 10,
      subScores: subScores,
      details: details,
      summary: finalScore >= 7 ? '有益且尊重用户' : (finalScore >= 5 ? '需改进伦理方面' : '可能存在伦理隐患'),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 维度三：美（审美/清晰度维度）
  // ════════════════════════════════════════════════════════════

  /**
   * [v2.1.0] 美作为清晰度的评估
   * 评估：逻辑结构、可读性、简洁性、可理解性
   */
  evaluateBeauty(answer) {
    var score = 7;
    var details = [];
    var subScores = {
      structure: 0,
      readability: 0,
      conciseness: 0,
    };

    if (!answer || answer.length === 0) {
      return { dimension: '美', score: 4, details: ['无内容'], summary: '无内容可评估' };
    }

    // 1. 逻辑结构评估
    var structureMarkers = ['首先', '其次', '然后', '最后', '第一', '第二', '第三', '一方面', '另一方面',
                            '首先', '其次', '最后', 'first', 'second', 'third', 'finally',
                            '步骤1', '步骤2', '步骤3',
                            '总结', '总之', '综上所述'];
    var structureCount = 0;
    for (var s = 0; s < structureMarkers.length; s++) {
      if (answer.indexOf(structureMarkers[s]) !== -1) {
        structureCount++;
      }
    }
    if (structureCount >= 3) {
      subScores.structure = 1.5;
      score += 1.5;
      details.push('结构清晰（+' + 1.5 + '）');
    } else if (structureCount >= 1) {
      subScores.structure = 0.5;
      score += 0.5;
      details.push('有一定结构（+' + 0.5 + '）');
    } else {
      subScores.structure = -0.5;
      score -= 0.5;
      details.push('缺乏逻辑结构（-0.5）');
    }

    // 2. 可读性：段落长度和句子复杂度
    var paragraphs = answer.split('\n').filter(function(p) { return p.trim().length > 0; });
    var avgParaLength = paragraphs.length > 0
      ? answer.replace(/\n/g, '').length / paragraphs.length
      : answer.length;

    if (avgParaLength > 500) {
      score -= 1;
      details.push('段落过长，建议分拆（-1）');
    } else if (avgParaLength > 200) {
      score -= 0.3;
      details.push('段落偏长（-0.3）');
    } else if (avgParaLength >= 50 && avgParaLength <= 150) {
      subScores.readability = 1;
      score += 1;
      details.push('段落长度适中（+1）');
    }

    // 3. 简洁性
    var totalLength = answer.length;
    if (totalLength > 1000) {
      score -= 0.5;
      details.push('回答较长（-0.5）');
    } else if (totalLength > 2000) {
      score -= 1;
      details.push('回答过长，建议精简（-1）');
    } else if (totalLength > 50 && totalLength < 500) {
      subScores.conciseness = 0.5;
      score += 0.5;
      details.push('长度适中（+0.5）');
    }

    // 4. 可理解性：有例子/类比
    if (/比如|例如|举例|就像|好比|类比|打个比方|imagine|for example|like|as if|similar to/i.test(answer)) {
      score += 0.5;
      details.push('有例���/类比（+0.5）');
    }

    // 5. 视觉辅助（列表、分点）
    if (/[-*•]\s|^\d+\.\s/m.test(answer)) {
      score += 0.5;
      details.push('使用列表/分点（+0.5）');
    }

    var finalScore = Math.max(1, Math.min(10, score));

    return {
      dimension: '美',
      score: Math.round(finalScore * 10) / 10,
      subScores: subScores,
      details: details,
      summary: finalScore >= 7 ? '表达优美，结构清晰' : (finalScore >= 5 ? '可以改进表达' : '需要大幅精简和重组'),
    };
  }

  // ════════════════════════════════════════════════════════════
  // [v2.1.0] 利益相关者影响分析
  // ════════════════════════════════════════════════════════════

  /**
   * 分析回答对不同利益相关者的影响
   */
  analyzeStakeholderImpact(answer, context) {
    var impacts = [];

    for (var i = 0; i < this.stakeholderTypes.length; i++) {
      var sh = this.stakeholderTypes[i];
      if (!sh.active) continue;

      var impact = this._evaluateImpactOn(sh, answer, context);
      if (impact) {
        impacts.push(impact);
      }
    }

    return {
      impacts: impacts,
      totalStakeholders: this.stakeholderTypes.filter(function(s) { return s.active; }).length,
      mostAffected: impacts.length > 0 ? impacts.reduce(function(a, b) {
        return Math.abs(a.impactScore) > Math.abs(b.impactScore) ? a : b;
      }) : null,
    };
  }

  /**
   * 评估对某类利益相关者的影响
   */
  _evaluateImpactOn(stakeholder, answer, context) {
    var score = 0;
    var reason = '';

    switch (stakeholder.id) {
      case 'user':
        // 用户：回答是否直接帮助/伤害用户
        if (/帮助你|对你有|为了你|你能|你可以/.test(answer)) {
          score = 1.5;
          reason = '直接帮助用户';
        } else if (/你必须|你不能|你错了|你不应该/.test(answer)) {
          score = -1;
          reason = '可能对用户造成压力';
        } else {
          score = 0.5;
          reason = '中性或一般影响';
        }
        break;

      case 'others':
        // 其他人：是否存在群体评价或建议
        if (/对.*（人|用户|群体）|他人|别人|第三方/.test(answer)) {
          score = 0.5;
          reason = '提到了对他人影响';
        } else if (/建议|推荐/.test(answer) && answer.length > 100) {
          score = 0.3;
          reason = '可能间接影响他人';
        } else {
          score = 0;
          reason = '直接影响有限';
        }
        break;

      case 'society':
        // 社会：是否涉及公共利益
        if (/社会|公共|群体|全体|大众|环境|生态|可持[续续]/.test(answer)) {
          score = 1;
          reason = '涉及公共利益考量';
        } else if (/歧视|不平等|弱势|边缘/.test(answer)) {
          score = 1.5;
          reason = '关注社会公平议题';
        } else {
          score = 0;
          reason = '对社会影响中性';
        }
        break;

      case 'system':
        if (/系统|平台|性能|资源|负载/.test(answer)) {
          score = 0.3;
          reason = '可能影响系统运作';
        } else {
          score = 0;
        }
        break;
    }

    return {
      stakeholder: stakeholder.label,
      impactScore: score,
      reason: reason,
    };
  }

  // ════════════════════════════════════════════════════════════
  // [v2.1.0] 自适应学习和反馈
  // ════════════════════════════════════════════════════════════

  /**
   * 提供用户反馈，调整伦理审查参数
   */
  receiveFeedback(feedback) {
    if (!this.adaptiveState.enabled) return false;

    this.adaptiveState.feedbackCount++;

    // 调整严格度
    var adjustment = {
      field: feedback.field || 'threshold',
      delta: feedback.delta || 0,
      reason: feedback.reason || '用户反馈',
    };
    this.adaptiveState.recentAdjustments.push(adjustment);
    if (this.adaptiveState.recentAdjustments.length > 20) {
      this.adaptiveState.recentAdjustments.shift();
    }

    // 应用调整
    if (feedback.field === 'threshold') {
      var newThreshold = this.threshold + (feedback.delta || 0);
      this.threshold = Math.max(15, Math.min(30, newThreshold));
    } else if (feedback.field === 'minDimension') {
      var newMin = this.minDimensionScore + (feedback.delta || 0);
      this.minDimensionScore = Math.max(3, Math.min(8, newMin));
    } else if (feedback.field === 'weightTruth') {
      this.weights.truth = Math.max(0.5, Math.min(2.0, this.weights.truth + (feedback.delta || 0)));
    } else if (feedback.field === 'weightGoodness') {
      this.weights.goodness = Math.max(0.5, Math.min(2.0, this.weights.goodness + (feedback.delta || 0)));
    } else if (feedback.field === 'weightBeauty') {
      this.weights.beauty = Math.max(0.5, Math.min(2.0, this.weights.beauty + (feedback.delta || 0)));
    }

    // 记录用户偏好
    if (feedback.preference) {
      for (var key in feedback.preference) {
        if (feedback.preference.hasOwnProperty(key)) {
          this.adaptiveState.userPreference[key] = feedback.preference[key];
        }
      }
    }

    return true;
  }

  // ════════════════════════════════════════════════════════════
  // [v2.1.0] 增强版检查和修正
  // ════════════════════════════════════════════════════════════

  /**
   * 检查并修正回答
   * 可根据特定维度的不足做精确修正（不再使用一刀切的方法）
   */
  checkAndRefine(answer, context) {
    var result = this.holisticAlignment(answer, context);

    if (result.passed) {
      return { answer: answer, result: result, refined: false };
    }

    var refinedAnswer = answer;
    var refinements = [];

    // 详细分析各维度弱点
    if (result.scores.truth.score < this.minDimensionScore) {
      var truthResult = this.evaluateTruth(answer, context);
      if (truthResult.breakdown && truthResult.breakdown.speculativeStatements === 0
          && truthResult.details.length > 0) {
        // 缺少不确定性标注
        refinedAnswer = this._addContextMarkers(refinedAnswer);
        refinements.push('补充不确定性标注');
      }
      if (truthResult.breakdown && truthResult.breakdown.factualClaims === 0) {
        refinedAnswer = this._addEvidencePrompt(refinedAnswer);
        refinements.push('提示需补充事实支撑');
      }
    }

    if (result.scores.goodness.score < this.minDimensionScore) {
      if (!(/选择权|决定|你自己/.test(refinedAnswer))) {
        refinedAnswer = this._addAutonomyRespect(refinedAnswer);
        refinements.push('补充自主权确认');
      }
    }

    if (result.scores.beauty.score < this.minDimensionScore) {
      refinedAnswer = this._simplifyAnswer(refinedAnswer);
      refinements.push('简化表达');
    }

    var recheck = this.holisticAlignment(refinedAnswer, context);

    return {
      answer: refinedAnswer,
      result: recheck,
      refined: true,
      refinements: refinements,
    };
  }

  /**
   * 补充不确定性标注
   */
  _addContextMarkers(answer) {
    // 在句末补充可能性标注
    var markers = [
      ['。', '，这可能不是唯一答案。'],
      ['。', '，具体情况可能有所不同。'],
      ['。', '，这取决于具体语境。'],
    ];
    var modified = answer;
    var added = 0;
    for (var i = 0; i < markers.length && added < 2; i++) {
      if (modified.indexOf(markers[i][0]) !== -1) {
        modified = modified.replace(markers[i][0], markers[i][1]);
        added++;
      }
    }
    return modified;
  }

  /**
   * 提示补充证据
   */
  _addEvidencePrompt(answer) {
    return answer + '\n\n（以上建议基于一般性知识，如需更精确的建议可补充具体信息。）';
  }

  /**
   * 补充自主权确认
   */
  _addAutonomyRespect(answer) {
    return answer + '\n\n最终的选择权在你，你可以根据自己的具体情况做出最适合的判断。';
  }

  /**
   * 简化回答
   */
  _simplifyAnswer(answer) {
    var lines = answer.split('\n').filter(function(l) { return l.trim(); });
    if (lines.length > 6) {
      return lines.slice(0, 6).join('\n') + '\n\n（内容已精简，回复"详细说明"可获取完整版本）';
    }
    return answer;
  }

  // ════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════

  getRejectionReason(scores) {
    var failures = [];
    if (scores.truth.score < this.minDimensionScore) {
      failures.push('真(' + scores.truth.score + '/' + this.minDimensionScore + ')');
    }
    if (scores.goodness.score < this.minDimensionScore) {
      failures.push('善(' + scores.goodness.score + '/' + this.minDimensionScore + ')');
    }
    if (scores.beauty.score < this.minDimensionScore) {
      failures.push('美(' + scores.beauty.score + '/' + this.minDimensionScore + ')');
    }
    if (scores.truth.score * this.weights.truth
      + scores.goodness.score * this.weights.goodness
      + scores.beauty.score * this.weights.beauty < this.threshold) {
      failures.push('总分不足(' + this.threshold + ')');
    }
    return failures.join(', ');
  }

  getHistory() {
    return this.history;
  }

  getStatus() {
    var recentPassed = 0;
    var totalRecent = Math.min(this.history.length, 50);
    for (var i = this.history.length - totalRecent; i < this.history.length; i++) {
      if (this.history[i] && this.history[i].passed) recentPassed++;
    }

    return {
      version: '2.1.0',
      threshold: this.threshold,
      weights: this.weights,
      minDimensionScore: this.minDimensionScore,
      totalChecks: this.history.length,
      passed: this.history.filter(function(h) { return h.passed; }).length,
      failed: this.history.filter(function(h) { return !h.passed; }).length,
      recentPassRate: totalRecent > 0 ? Math.round(recentPassed / totalRecent * 100) + '%' : 'N/A',
      adaptiveEnabled: this.adaptiveState.enabled,
      feedbackCount: this.adaptiveState.feedbackCount,
      counterfactualBound: this._counterfactualEngine !== null,
      stakeholderCount: this.stakeholderTypes.filter(function(s) { return s.active; }).length,
    };
  }
}

module.exports = { EthicsGuard };
