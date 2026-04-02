
写在前面：
年前因为 openclaw 爆发了一波 AI 大热潮，相伴而来的还有一个叫做 Harness Engineering 的新词汇。
如果是做了几年 AI 的同学，应该会觉得 Harness Engineering 不足为奇 —— 几个月甚至几年之前，大家就已经在尝试使用 Harness Engineering 的核心反馈循环去 build 经典的 ReAct tool-call 框架了，所以无论是从技术还是产品（虽然 PM 无需关注）上讲，这都不太算是一个值得拿出来说道的内容。
但是，来自 Aditya Shrishpuranik 于 3 月 2 日发表的文章《The Control Theory Behind Harness Engineering》，他直接映射了 Harness Engineering 和 The Control Theory 的映射关系 —— 两个学科的结合，这就是有意思的点了。
正好，笔者本科学过一点控制论，又做了一阵 AI，所以想从控制论的角度，切一下 Harness Engineering 这个场景，希望可以带来不同的碰撞。
Zylan

另注：由于 Harness Engineering 持续迭代（比如文章刚写完 Anthropic 就发了新的 blog），本文会保持继续保持更新一段时间。

其他博客文章：
《Agent 架构综述：从 Prompt 到 Context》
《年终调研：2025 全年 AI 产品及架构演进历程》
关于作者：
https://blog.zihanjian.com/readme


---
正文分割线

---

文档略长，可自行选择感兴趣的部分阅读。
一、X-Engineering Timeline
三个概念在不到两年内依次登场，每一次交替背后的关键事件和时间线。
二、Context Engineering
一套已经在生产环境中跑着的输入端优化技术，以及它的天花板在哪。
三、Harness Engineering 有什么不同 
用控制论的五要素拆解 OpenAI 和 Anthropic 的两种 Harness 架构，定位开环与闭环的分界线。
四、行业佐证 
Vercel、LangChain 和 Anthropic早期 从不同维度独立验证同一个命题
五、从“In the loop”到“On the loop”
AI 工程师的核心能力正在从"让模型输出更好"迁移到"让包裹模型的控制系统更健壮"。
播客
如果不方便阅读长文，可以听播客（由 AI 针对初稿生成，有细节谬误和新文段遗漏）
暂时无法在飞书文档外展示此内容

 
1. Intro：X-Engineering Timeline

从早期的“提示词工程”（Prompt Engineering）到后来被广泛采用的“上下文工程”（Context Engineering），开发者们一直试图通过不断优化输入端的信息质量，来引导模型朝着期待的方向输出。而 Harness Engineering 通过构建包含机械约束、确定性反馈和持续状态管理的闭环控制系统，将高熵的模型输出强制收敛至稳定的正确状态。

三个概念 —— Prompt Engineering、Context Engineering、Harness Engineering —— 在不到一年内递进迭代，在同一条路径自然递推，但每一次交替背后都有具体的技术瓶颈和产业事件在驱动。所以，在展开技术分析之前，让我们先用三张时间线，从更广的维度去溯源一下：谁在什么时候做了什么、说了什么，概念又是怎么从实践中长出来的。

1.1 Prompt Engineering 里程碑
从 GPT-3 few-shot 到职位消亡 (2020–2025)
时间
事件
关键人物 / 机构
核心意义
2020年5月
GPT-3 论文发布，首次系统性展示 few-shot prompting 能力——仅靠 prompt 即可完成翻译、问答、补全等任务，无需梯度更新
OpenAI (Brown et al.)
Prompt engineering 作为实践的起点：证明了「怎么问」直接决定大模型输出质量
2022年1月
Chain-of-Thought (CoT) prompting 论文发布，提出在 prompt 中加入推理步骤示例可大幅提升模型在复杂推理任务上的表现
Google (Wei et al.)
Prompt engineering 从「问什么」升级到「怎么引导推理」，技巧体系化的标志
2022年11月
ChatGPT 发布，prompt engineering 从学术概念瞬间成为大众技能，"Prompt Engineer" 成为热门职位
OpenAI
Prompt 从研究方法变成生产力工具，推动全行业 prompt engineering 热潮
2023年
"Prompt" 成为牛津词典年度词汇亚军；Anthropic 以 $335K 年薪招聘 Prompt Engineer and Librarian
Oxford / Anthropic
Prompt engineering 社会影响力与薪酬天花板的双重巅峰
2023年 (全年)
RTF、RISEN、COSTAR 等 prompt 框架在 LinkedIn 刷屏；Tree-of-Thought (NeurIPS 2023)、Graph-of-Thought (AAAI 2024) 等高级 prompt 技术相继发表
Yao et al. / Besta et al.
Prompt 技巧从经验总结进入学术竞赛期，也是框架泛滥的「巅峰即拐点」
2025年初~中
LinkedIn "Prompt Engineer" profile 下降 40%；Indeed 该职位搜索从峰值 144/百万降至 ~20-30/百万；《华尔街日报》2025年5月称该职位「基本已过时」
Indeed / LinkedIn / WSJ
标志性的衰退信号：职位消亡，技能被吸收进 SWE、PM、Data Analyst 等角色

1.2 Context Engineering 里程碑
从 MCP 协议到方法论成熟 (2024–2025)
时间
事件
关键人物 / 机构
核心意义
2024年11月25日
Anthropic 开源 Model Context Protocol (MCP)，定义 LLM 与外部数据源/工具交互的标准协议，从基础设施层面回答「如何为模型提供上下文」
Anthropic
Context engineering 的基础设施先行者——先有管道，再有方法论
2024年12月19日
Anthropic 发布《Building Effective Agents》，提出 workflow vs. agent 框架，强调 augmented LLM (retrieval + tools + memory) 是 agent 的基本构建块
Anthropic (Schluntz & Zhang)
为 context engineering 提供了理论骨架：agent 的有效性取决于上下文的编排方式
2025年2月2日
Karpathy 发推创造 "vibe coding" 一词，获 510 万次浏览——描述「不读 diff、不写代码、全靠 LLM」的开发方式
Andrej Karpathy
对照叙事：vibe coding 暴露了「只靠 prompt 不够」的问题，为 context engineering 铺路
2025年3月
OpenAI 正式采纳 MCP 协议，集成至 ChatGPT 桌面端等产品；Google Agent2Agent (A2A) 协议于 4 月发布
OpenAI / Google
MCP 从 Anthropic 单方标准升级为行业共识；MCP (agent→tool) + A2A (agent→agent) 形成双层协议栈
2025年6月19日
Shopify CEO Tobi Lutke 发帖："I really like the term 'context engineering' over prompt engineering. It describes the core skill better: the art of providing all the context for the task to be plausibly solvable by the LLM."
Tobi Lutke
「命名时刻」——给业界已在做的事情赋予了一个流行名称，引爆社交媒体传播
2025年6月23日
LangChain 创始人 Harrison Chase 发布《The rise of context engineering》，给出被业界最广泛引用的工程化定义："building dynamic systems to provide the right information and tools in the right format such that the LLM can plausibly accomplish the task"
Harrison Chase (LangChain)
将 context engineering 从口号提升为工程规范——核心是「系统」而非「字符串」
2025年6月25日
Karpathy 跟进发帖，补充定义为「在工业级 LLM 应用中，将恰当信息填充到上下文窗口的精妙艺术与科学」，获约 230 万次浏览
Andrej Karpathy
技术权威背书 + 大众传播，让 context engineering 概念破圈
2025年7月
Gartner 发布《Top Strategic Trends in Software Engineering for 2025 and Beyond》，将 context engineering 列为关键趋势，定义为 "the practice of designing and structuring the right data" 以支撑 AI Agent 运行
Gartner
企业级认证：从社交媒体热词升级为分析机构战略建议，"context engineering is in, prompt engineering is out"
2025年9月29日
Anthropic 发布《Effective Context Engineering for AI Agents》，提出 compaction、structured note-taking、sub-agent 三大长任务策略，系统性阐述 context rot、attention budget 等概念
Anthropic
迄今最系统的 context engineering 工程指南——从概念阶段推向可落地的方法论
标志性事件：
2025 年中，Shopify CEO Tobi Lutke 发帖（2025年6月中旬），内容为："I really like the term 'context engineering' over prompt engineering. It describes the core skill better: the art of providing all the context for the task to be plausibly solvable by the LLM." 这条帖子在圈内迅速扩散，大厂从业者和创业者纷纷在评论区喊"+1"。
[图片]
Andrej Karpathy 于2025年6月18日跟进，发布了他自己的独立解读，补充道：context engineering 是"在工业级 LLM 应用中，将恰当信息填充到上下文窗口的精妙艺术与科学"，该帖获得了约 230 万次浏览。 他特别指出，"prompt"这个词让人联想到日常随手输入的短描述，而工业级系统根本不止于此。
[图片]
不过除此之外，Harrison Chase 是 context engineering 定义的关键贡献者，他在 Tobi 和 Karpathy 之间（6月23日）给出了被业界最广泛引用的工程化定义。


1.3 Harness Engineering 里程碑
从 vibe coding 到环境设计范式 (2025–2026)
时间
事件
关键人物 / 机构
核心意义
2025年2月2日
Karpathy "vibe coding" 推文引发对 AI 生成代码质量的广泛讨论——代码可以 vibe 出来，但谁来保证质量？
Andrej Karpathy
前奏：vibe coding 的局限催生了对「环境约束」的需求，即后来的 harness
2025年8月
OpenAI 内部实验启动：Ryan Lopopolo 团队开始以「0 行手写代码」为约束，用 Codex Agent (GPT-5) 构建一个内部产品
Ryan Lopopolo / OpenAI
实验起点——通过极端约束倒逼团队思考「当人不写代码时，工程师该做什么」
2025年11月
Anthropic 在 Claude Agent SDK 中开始使用 "harness" 一词描述 agent 基础设施——"a powerful, general-purpose agent harness"
Anthropic
"harness" 概念开始在头部公司技术文档中出现，但尚未被广泛讨论
2026年1月
LangChain Harrison Chase 在 Sequoia 播客中系统阐述 scaffold → harness 的演进，提出 "traces are the new source of truth"、"everything is context engineering"
Harrison Chase (LangChain)
框架层面的理论化：从 scaffold (刚性脚手架) 到 harness (弹性缰绳) 的范式跃迁
2026年2月5日
Mitchell Hashimoto (HashiCorp / Terraform 创始人) 发布博客《My AI Adoption Journey》，首次命名 "harness engineering"——"anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again"
Mitchell Hashimoto
「命名时刻」——给这套实践赋予了一个清晰的名字，类似 Tobi 之于 context engineering
2026年2月11日
OpenAI Ryan Lopopolo 发布《Harness Engineering: Leveraging Codex in an Agent-First World》——3 人起步（后扩展至 7 人），5 个月内生成约 100 万行代码，合并约 1500 个 PR，每人日均 3.5 个 PR，0 行手写代码
Ryan Lopopolo / OpenAI
首个大规模 harness engineering 实战报告——证明人类角色从「写代码」变为「设计环境、指定意图、构建反馈循环」
2026年2月17日
Martin Fowler 跟进评论，将 harness 拆解为三层架构：① Context engineering (知识库 + 动态上下文) ② Architectural constraints (linter + 结构测试) ③ "Garbage collection" (周期性清理 agent)
Martin Fowler (ThoughtWorks)
软件工程权威赋予 harness engineering 清晰的分层框架，便于工业界落地
2026年2月18日

Ethan Mollick 发布 AI 使用指南，以 Models / Apps / Harnesses 三层组织全文，进一步普及 harness 概念
Ethan Mollick (Wharton)
从技术圈扩展到商业与教育圈，harness 概念开始被非工程背景人群接受
2026年3月23日
Claude 发布 harness 设计文章：《Harness design for long-running application development》，在 Anthropic Engineering 博客上，它专门讲了他们怎么用多智能体 harness 把 Claude 推到更强的前端设计和长时间自主开发能力上。
Prithvi Rajasekaran（Anthropic Labs）
承接了一篇更早的官方文章《Effective harnesses for long-running agents》，引起了工业界的学习和传播
标志性事件：
2026 年 2 月 11 日，OpenAI 工程师 Ryan Lopopolo 发布了一篇文章——《Harness Engineering: Leveraging Codex in an Agent-First World》。文中写道，一个仅 3 人起步的团队，在 5 个月内用 Codex Agent 生成了约 100 万行代码，合并了约 1500 个 PR，平均每人每天 3.5 个 PR——没有一行是人手写的。
https://openai.com/zh-Hans-CN/index/harness-engineering/
有意思的是，"Harness Engineering" 一词的首创者不是 Ryan Lopopolo，而是 Mitchell Hashimoto（2026年2月5日），比 OpenAI 文章早 6 天 —— OpenAI 文章让这个概念广为传播，但命名权归 Hashimoto。






三个概念交替，间隔不到一年。

虽看似同一条路径的演进，但其中分界依然清晰。

这篇文章想聊的，就是这道分界 —— 以及理解它所需要的、来自1948 年的 Control Theory（控制理论）。





---




2. Context Engineering

Context Engineering 已经是一套完善的、在生产环境中跑着的具体技术。
让我们回顾一下这门古老的技术，然后用几个具体例子来串联记忆。


2.1 从 Prompt 到 Context 概要

详见笔者这一篇：《Agent 架构综述：从 Prompt 到 Context》

Prompt Engineering 解决的核心问题是"我该怎么问"。在大型语言模型普及的初期阶段，它是开发者与模型交互的主要手段。在这个阶段，提示工程师的任务是通过调整措辞来“哄骗”模型输出最优解，比如 few-shot 示例、Chain-of-Thought、角色设定。它优化的是单次交互中人对模型的表达方式。
PE 在复杂系统中的失效原因是多维度的。
- 首先是复杂度无法承载的问题。随着任务链条的拉长，为了弥补信息缺失，开发者往往会向提示词中不断添加异常处理逻辑和背景设定，导致提示词迅速膨胀，最终变得庞大且难以管理。
- 其次，在庞杂的指令文本中，工具调用的具体规则和参数规范往往被上下文噪音所淹没，导致模型在关键节点调用错误的工具或使用错误的参数格式。
- 更为严重的是，静态提示无法实时注入微服务的实时状态、用户历史交互的完整图谱或会话专属记忆，这就迫使模型在信息盲区中进行概率层面的猜测，从而不可避免地引发严重的幻觉（Hallucination）。

为了克服静态提示词的局限性，自2025年中期开始，上下文工程（Context Engineering）作为一种进化形态迅速崛起。Gartner 的相关研究指出，大多数人工智能代理的失败是上下文的失败，而不是模型本身的失败 —— 这一论断推动了行业重心的转移。

Context Engineering 把问题升级为"模型需要知道什么"，它将大语言模型的上下文窗口视为一种稀缺且极其有限的计算资源，进行动态的系统化管理。它重构了喂给模型的信息装配流水线，其核心目标是决定模型在每一个推理步骤中应该知道什么、何时知道、以及这些信息应该如何被结构化地呈现。

LangChain 在 2025 年 6 月的博文中给出了明确定义：
"Context engineering 是提供正确的信息和工具，以正确的格式呈现，使 LLM 能够完成单靠提示词无法完成的复杂任务。"
[图片]

2.2 一个例子：Anthropic 的 Agent Skills

Anthropic 的 Claude Agent Skills 对于 Context Engineering 是教科书级别的实现。
它的核心机制叫 渐进式披露（Progressive Disclosure）：

- Level 1（元数据）： 启动时加载，每个 Skill 仅占约 100 token。只包含名称和描述，嵌入系统提示。Claude 仅知道 "这个 Skill 存在，什么时候用"。
- Level 2（指令）： 触发时加载，通常不超过 5K token。Claude 通过 bash 读取 SKILL.md 文件，将具体操作指南送入上下文窗口。
- Level 3（资源和代码）： 按需加载，token 开销理论上无限。Claude 执行脚本时，脚本代码本身不进入上下文，只有输出结果进入。

[图片]

核心设计思想：只有当前步骤相关的上下文才占用窗口，其余留在文件系统中等待按需调取。

2.3 另一个例子：Manus 的上下文工程实践

Manus 为 Context Engineering 提供了血淋淋的实战经验。他们重建了代理框架四次（自嘲叫做 Stochastic Graduate Descent —— 随机献祭研究生），每次都是因为发现了更好的上下文塑造方式。

他们沉淀出几条 hard-core 经验：

1. KV-cache 命中率是最重要的单一指标。 Manus 的 agent 运行中，输入输出 token 比约为 100:1。在 Claude Sonnet 上，缓存输入 token 的价格是 $0.30/MTok，未缓存是 $3/MTok——10 倍差距。这意味着上下文组装方式的微小变化（比如在系统提示开头加一个秒级的时间戳），就足以 kill 掉整个缓存命中率。他们的实践是：保持提示前缀绝对稳定，上下文只追加、不修改，并且确保 JSON 序列化的键顺序是确定性的。

2. 不要 delete tools，要 mask tools。 MCP 的流行让工具数量迎来了大幅爆炸，Manus 试过动态添加/移除工具（类似 RAG 按需加载），但发现这会导致工具定义区域变化，使其后所有 action/observation 的 KV-cache 失效。并且，当之前的动作引用了一个已被移除的工具时，模型会产生幻觉。他们的解决方案是：用上下文感知的状态机，在解码阶段通过 token logits 掩码来约束动作空间，而不改变工具定义本身。 
  比如，所有浏览器工具以 browser_ 开头，命令行工具以 shell_ 开头，这样只需预填充到函数名前缀，就能将选择范围限制在某一类工具中：
# 强制 Agent 只能调用浏览器类工具
<|im_start|>assistant<tool_call>{"name": "browser_

3. 文件系统就是终极上下文。 128K 上下文窗口看似巨大，但代理场景下经常不够用（网页抓取、PDF 解析产生的观察数据量极大）。Manus 的做法是：把文件系统当作结构化的外部记忆，模型学会按需读写文件，而不是把一切都塞进上下文窗口。压缩策略始终是可恢复的——网页内容可以从上下文丢弃（保留 URL），文档内容可以省略（保留沙箱路径）。
详见笔者另一篇：《【探索实践】比 Manus 更好的形态是什么》

2.4 Context Engineering 的天花板

这些实践都是真实有效的。Manus 通过这些优化在生产环境中服务了大量用户，Anthropic 的 Skills 架构也在 Claude Code 中经受住了考验。

但它们全都是在回答同一个问题 —— "如何让模型在这一次推理中，获得更好的上下文？"

无论是渐进披露、KV-cache 优化、工具掩码，还是文件系统记忆 —— 它们优化的都是输入端。
它们假设：如果模型看到了正确的信息、用了正确的工具、在正确的上下文窗口中推理，输出就会是好的 —— 这个假设在单次推理中大概率成立。但在一个需要持续运行数小时、数天、数周的代理系统中，一个根本性的问题浮现了：即使每一次推理的上下文都是"最优"的，你也无法保证这个概率系统在长期运行中不发生漂移、不累积错误模式、不在无人值守时悄悄退化。

所以，尽管上下文工程通过构建复杂的检索管道和动态记忆网络，极大地提升了模型在特定领域的表现，但其底层范式依然没有发生实质性的改变。在这些架构中，系统虽然拥有了极其庞大的信息库，开发者们也构建了一个拥有强健执行力（Actuators/Muscles，例如 LangChain 和各类向量数据库的组合）和一定刚性约束（Constraints/Skeleton，例如强制输出 JSON Schema 以对抗语法熵）的终极机器，但依然无法对模型生成过程中产生的瞬时误差做出实时反应。

这就是 Context Engineering 没有回答的另一个问题：输出偏了之后怎么办？

而这，也是 Harness Engineering 接手的地方。


---

3. Harness Engineering 有什么不同

要深刻理解 Harness Engineering 崛起的必然性，必须从根本上转变从软件工程、物理学、人工智能、模型、数学本质做切入的思考方式。

传统的软件工程构建在低熵（Low entropy）、确定性的基础之上。

无论是编译器的语法树解析、关系型数据库的事务处理，还是工业机器人的运动学方程，其输入 x 到输出 y 的映射概率都是严格的 P(x|y) = 1。在这种古典范式下，任何程度的模糊性或随机性都被视为系统缺陷（Bug），必须被彻底消除。

然而，大语言模型的广泛应用代表了整个计算机科学向“行为软件”（Behavioral Software）领域的转变。以 Transformer 架构为基础的大型语言模型，其优化目标是最大化序列似然 —— 输出不再是一个确定的值，而是一个概率分布 $$y \sim P(y|x)$$ 。如果任由其自由生成而不加干预，大语言模型将在浩瀚的高维语义空间中进行一种有偏的随机漫步（Biased random walk）。

面对这种呈指数级发散的随机系统，纯粹的输入端优化（无论是提示词微调还是更精准的上下文检索）在数学上都是徒劳的。解决这一问题的唯一工程学和数学途径，是引入控制理论（Control Theory）中的闭环控制架构。

OpenAI 那篇文章里有一句很简单的话：

Humans steer. Agents execute.

"掌舵"（steer）这个词也许是随意选的，但笔者相信冥冥之中自有天意 ☝️ —— 1948 年，数学家 Norbert Wiener 出版了《Cybernetics》，创立控制论。Cybernetics 来自希腊语 κυβερνήτης，意思就是"舵手"。Wiener 的核心发现是：几乎所有复杂系统的稳定性，都来自信息的反馈回路（feedback loop）——恒温器感知温度、比较设定值、调节加热；人体神经系统感知外界、发出指令、监测效果、不断修正。

Harness Engineering 做的正是这件事 —— 只不过被控对象从蒸汽机、从服务器集群，变成了 LLM。

Harness Engineering 彻底放弃了单纯依靠文本和提示词去驱动模型的幻想，转而采用控制理论（Control Theory）的核心思想，通过构建包含机械约束、确定性反馈和持续状态管理的闭环控制（Closed-loop Control）系统，将高熵的模型输出强制收敛至稳定的正确状态。

3.1 控制理论基础（简约版）

要深入了解，需要掌握最最基础的控制理论知识，列举如下：

一个完整的控制系统可以视为具有 量测、比较、计算和修正 四种功能，
由 被控对象、传感系统、控制器、执行机构 以及 反馈机制 五类元素共同构成：
  - 被控对象（Plant）：需要被调节的系统或过程
  - 传感器（Sensor）：测量系统输出，使状态可观测
  - 控制器（Controller）：接收误差信号，计算修正指令
  - 执行机构（Actuator）：根据控制器的输出信号，对被控对象施加作用
  - 反馈回路（Feedback Loop）：将输出送回与参考值比较，持续修正，是控制理论的核心思想

反馈与误差信号
控制的核心在于负反馈：误差信号 e=r(t)−y(t)（参考值减去传感器测量值）被传入控制器，控制器据此调整输入u，驱动系统输出趋近目标值 。控制论创始人 Wiener 将此定义为"动物与机器中控制和通讯的科学"，强调反馈与信息交换缺一不可 。

开环 vs 闭环
开环控制不使用反馈，结构简单但抗扰能力差；
闭环控制引入反馈，能自动补偿干扰和模型误差，是现代控制系统的主流形式 。

以上是后面所有讨论的地图，接下来逐一展开。

3.2 用控制论拆解 OpenAI 的 Harness

要理解 OpenAI 团队的设计哲学，先引入 Harness Engineering 的底层哲学。

它可以用一个简洁的公式概括：Agent = Model + Harness（代理 = 模型 + 治理框架）。在这个定义中，模型（Model）仅仅是一个包含了压缩世界知识和模式识别能力的智能核心，而 Harness 则是所有那些“不是模型本身”的代码、配置和执行逻辑的总和。如果你构建的系统组件不是那个处理 Token 的神经网络模型，那么它就属于 Harness 的范畴，它是 context engineering 的父级。

接下来我们划分一下这个系统中的 被控对象、传感系统、控制器、执行器 以及 反馈机制 ：

3.2.1 被控对象：一个会漂移的概率系统

控制论的起点永远是同一个问题：你要控制的东西，它的动力学特性是什么？

LLM 的特性很明确：它是一个随机系统。给定相同的输入，不一定产出相同的结果。更致命的是，它会自我强化坏模式 —— 生成第一个 Token 时的微小偏差，作为上下文输入参与到下一个 Token 的生成中，误差逐步累积。Yann LeCun 把这叫做"呈指数级发散的随机过程"。

OpenAI 团队观察到了这个特性的具体表现：
"Codex 会复制仓库中已经存在的模式——即使是不均匀的、次优的模式。随着时间推移，这不可避免地导致漂移。"

最初他们试图靠人来修正：
每周五花 20% 的时间清理 "AI slop"。
不出意外，这完全不可扩展 —— 你不能用人工去对抗一个 7×24 运行的随机过程的熵增。

这就决定了整个系统设计的基调：被控对象本身是不可信的，稳定性必须来自外部的闭环约束，而不是对模型本身的期望。

3.2.2 传感器：让系统的每一层状态都可观测

控制论的第一条铁律：传感器的精度决定了控制的精度。如果你无法测量系统的状态，你就无法控制它。

Context Engineering 关注的是"人类想给模型看什么"。而 Harness Engineering 首先关注的是"模型自己能看什么"—— 这是输入优化思维和控制论思维的根本区别。

OpenAI 团队做的传感器工程极其细致：
1. 让 Agent 能直接感知应用的运行状态。 为每个 git worktree 搭建独立的应用实例和临时可观测性栈（日志、指标、trace），Agent 可以用 LogQL 查日志、用 PromQL 查指标。这使得像"确保服务启动在 800ms 内完成"或"关键用户追溯中没有 span 超过 2 秒"这样的指令变得可执行 —— 因为它们变成了可测量的信号，而不是一句自然语言的期望。
2. 让 Agent 能"看见"UI。 接入 Chrome DevTools Protocol，Agent 能处理 DOM 快照、截图和页面导航，像人一样启动应用、点击按钮、查看渲染结果。这把原本只存在于人眼中的"UI 对不对"，变成了 Agent 可以感知的反馈信号。
3. 质量趋势可观测。 质量文档（quality document）为每个产品域和架构层打分，持续追踪变化趋势。这是一个由人建立标准、由机器持续消费的传感器 —— 它不只是关注和测量某次输出的对错，更保证了系统在时间维度上的漂移方向。
4. 架构文档作为 system map。 不搞一个巨大的 AGENTS.md（他们试过，失败了——巨型文档"挤占任务和代码的上下文空间、什么都'重要'就等于什么都不重要、瞬间腐化成规则坟场、无法机械化验证"），而是一个约 100 行的 AGENTS.md 充当目录，指向 docs/ 下的结构化知识库。设计文档有目录和索引，包含验证状态；架构文档描述域和包的分层关系；执行计划（execution plans）带有进度和决策日志，版本化并提交到仓库。
5. etc.......

这些做法的共同逻辑是一致的：把 LLM 系统中原本不可观测的状态量（代码质量趋势、UI 渲染正确性、架构一致性、运行时性能），全部变成结构化的、可测量的信号。


3.2.3 控制器：编码在仓库中的判断标准

控制论中，控制器的职责是接收误差信号（期望状态 - 实际状态），然后计算出修正指令。

在 Harness Engineering 中，控制器是编码在仓库中的规则和标准：
自定义 Linter 规则是最典型的控制器，它们把修正指令直接注入 Agent 的推理过程：
Error: Circular dependency detected between module A and module B.
Error: Circular dependency detected between module A and module B.
Remediation: In this codebase, dependencies must flow forward through
Types → Config → Repo → Service → Runtime → UI.
Module A (Service layer) cannot import from Module B (Runtime layer).
Move the shared type to the Types layer, or use the Providers interface
for cross-cutting concerns like auth, connectors, or telemetry.
这段报错信息就是控制信号 —— 它包含了误差的描述（哪里违规了）和修正的指令（该怎么改）。而且它是确定性的：同样的违规永远产出同样的修正指令，不存在概率漂移。

Golden principles 是更高层的控制器：优先使用共享工具包而非手写辅助函数、不允许 YOLO 式数据探测、边界处必须验证数据形态。这些判断标准一旦编码，就脱离了人的即时参与，变成系统自动执行的控制逻辑。

而且，Linter 本身也是 Agent 生成的 —— 控制器在自我进化。

3.2.4 执行器：Agent 修改世界的能力

这一层最简单。在控制论中，执行器就是接收控制信号后对被控对象施加作用的组件 —— 阀门、电机、舵面。
在 Harness 中，执行器就是 Agent 修改代码、提交 commit、开 PR、回应 review 的能力。单一一次 Codex 运行可以持续超过 6 小时，端到端地完成从复现 Bug 到合并修复的完整流程。

举个例子，根据 openai 的示例，单一一次 Codex 运行可以持续工作超过 6 个小时（通常在人类睡觉的时候）。
在这段时间里，Agent 给定一个提示词就能端到端地完成：
验证代码库当前状态
复现报告的 Bug
录制一个视频展示失败
实现修复
驱动应用验证修复效果
录制第二个视频展示修复结果
打开 PR
回应 Agent 和人类的 review 意见
检测并修复 CI 构建失败
仅在需要人类判断时上报
合并变更
这里的关键词是"回应 review 意见"和"检测并修复 CI 构建失败"—— 也就是说，构建了一个持续迭代直到通过检验的反馈循环。

执行器本身不复杂。真正复杂的是：执行器的输出被送回传感器，形成闭环 —— 这就是下一节要讲的反馈回路。

3.2.5 反馈回路：四层级联控制

这是整个 Harness 架构中最关键的部分，也是它和 Context Engineering 的根本分界线。
控制论中有一个经典的设计模式叫级联控制（Cascade Control）：用多层嵌套的回路处理不同时间尺度的扰动 —— 快的内环处理高频扰动，慢的外环处理低频漂移。每一层回路解决上一层解决不了的问题。
OpenAI 团队构建的正是这样一个四层级联结构：

1. 第一层：秒级——确定性机械检验。 
  
  编译器、测试套件、Linter。代码能不能跑、测试过不过、格式对不对。
  
  这是最快的内环。它处理的是高频、确定性的扰动 —— 语法错误、类型不匹配、依赖方向违规。传统软件工程早就有这些组件，但在 Harness 中它们的角色发生了变化：它们不只是面向人类的质量门禁，而是 Agent 推理循环的一部分。Linter 报错 → Agent 读取 → 修正 → 重新提交 → 再次检验，这个循环在秒级完成，不需要任何人参与。

2. 第二层：小时级——Agent-to-Agent Review。 
  
  当第一层的确定性检验全部通过后，代码进入 Agent 之间的交叉审查。一个 Agent 写代码并本地自审，然后请求其他 Agent 进行 review。多个 reviewer 给出意见后，写代码的 Agent 持续迭代，直到所有 reviewer 满意。
  
  这一层处理的是第一层处理不了的问题 —— 代码能跑、测试通过，但设计是否合理？命名是否清晰？是否引入了不必要的复杂度？这些判断需要语义理解，不能用确定性规则覆盖，所以用 Agent 的概率推理来处理。
  
  OpenAI 内部管这个叫 "Ralph Wiggum Loop"（这个取名来自于辛普森一家）。
  
  人类可以参与 review，但不是必须的。随着时间推移，几乎所有 review 工作已经由 Agent 对 Agent 完成。
  
3. 第三层：日级——"垃圾回收"机制。 
  
  这是 Context Engineering 完全没有触及的层面。
  
  后台 Codex 任务按固定节奏扫描整个代码库，对照 golden principles 检测慢性漂移 —— 架构退化、文档腐化、模式不一致。检测到偏差后，自动开出定向重构 PR，大多数可以在一分钟内审核并自动合并。
  
  这一层的控制论意义在于：即使第一层和第二层在每次 PR 上都表现完美，系统仍然会随时间累积低频偏差。就像一栋楼的每一块砖都合格，但整栋楼可能在缓慢倾斜。日级的垃圾回收 Agent 就是检测这种结构性漂移的传感器 + 执行器。
  
这些 "golden principles" 是什么样的？举一些例子：
1. 优先使用共享工具包而非手写辅助函数——保持不变量集中化。如果 Agent 在某个模块里重新实现了一个已有的工具函数，垃圾回收 Agent 会检测到并发起重构。
2. 不允许"YOLO 式"数据探测——必须在边界处验证数据形态，或依赖类型化 SDK。Agent 不能凭猜测构建数据结构。
3. Etc ..
  
  OpenAI：
"技术债像高利贷：小额持续偿还几乎总是好过让它累积后痛苦地集中清理。人类的品位被一次性捕获，然后在每一行代码上持续执行。"
  
4. 第四层：周/月级——反馈回路自身的进化。

  当 Agent 持续在某类问题上犯错，传统的 CE 修正方式是"改提示词"，而 openai 是把判断标准编码进仓库本身 —— 写进架构文档、写进自定义 Linter 规则、写进结构化测试、升级质量评分标准。然后垃圾回收 Agent 在日常扫描中执行这些新规则。
  
  OpenAI 文章中有一段描述这个过程：
"When something failed, the fix was almost never 'try harder.' Because the only way to make progress was to get Codex to do the work, human engineers always stepped into the task and asked: 'what capability is missing, and how do we make it both legible and enforceable for the agent?'"
当某件事失败时，修复方式几乎从来不是"再试一次"。因为唯一的前进方式是让 Codex 完成工作，人类工程师总是介入并问："缺少什么能力？如何让它对 Agent 既可理解又可执行？"
  
  这是元层的反馈回路 —— 人类不再修代码，而是修控制系统本身。人的判断被一次性编码进仓库，然后在每一行代码上持续自动执行。

3.3 用控制论拆解 Anthropic 的 Harness

如果说 OpenAI 的 Harness 是一个经典的多层级联控制系统，Anthropic 在 2026 年 3 月由 Prithvi Rajasekaran 发布的《Harness design for long-running application development》展示了另一条路径：把生成和评估拆成独立 Agent，用对抗性反馈取代自评。

这是 Anthropic 2025 年 11 月那篇《Effective Harnesses for Long-Running Agents》的续作（该篇文章会在 4.3 节提及）。早期方案是两阶段结构（初始化 Agent 建立环境，编码 Agent 逐个实现 feature）。新方案把系统升级为三个专职 Agent —— 规划者（Planner）、生成者（Generator）、评估者（Evaluator）。

用控制论的视角来拆解这个架构：

3.3.1 被控对象：一个会自我欺骗的生成系统

OpenAI 面对的核心问题是"模型会漂移"。Anthropic 发现了一个更根本的问题：Agent 会对自己的输出过度自信，即使产出平庸也会给出高评价。

在可验证的任务中（代码能不能跑、测试过不过），这个问题可以靠确定性工具缓解 —— 编译器不会因为 Agent 的自信而放行错误代码。但在主观性任务 —— 尤其是前端设计 —— 中，这个问题致命。没有编译器能告诉你一个 UI 是否"有设计感"，Agent 自己审自己，几乎总是"自我感觉良好"。

这是控制论中的一个经典问题：
如果传感器和执行器是同一个实体，反馈信号就会被自利偏差污染，闭环退化为开环。 

Anthropic 的解法和 GAN（生成对抗网络）有直觉上的相似 —— 生成器和判别器分离，形成对抗张力。

3.3.2 传感器：Playwright MCP + 四维评分体系

评估者（Evaluator）是这个系统的核心传感器。

它的感知能力远超"读代码"：
- Playwright MCP 作为"眼睛"，通过评估者与运行中的应用实时交互 —— 点击按钮、导航页面、截屏、检查 API 端点、查看数据库状态 —— 像真实用户一样操作活的应用。和 OpenAI 用 Chrome DevTools Protocol 让 Agent "看见" UI 是同一个思路，但 Anthropic 走得更远 —— 因为这里的传感器不是写代码的 Agent 自己，而是一个独立的 observer。
- 四维评分标准量化主观判断。在 Anthropic 的前端设计例子中，评估者用四个维度打分，每个维度都有硬性阈值：
维度
评估内容
Design Quality
色彩、排版、布局、图像是否形成一致的情绪和身份感
Originality
是否有定制化的设计决策，而非模板布局、"AI 味"
Craft
排版层级、间距一致性、色彩和谐度、对比度
Functionality
用户能否理解界面、找到操作、完成任务
评分重点刻意偏向 Design Quality 和 Originality —— 因为 Craft 和 Functionality 在当前模型能力下，默认执行结果就不错，真正能拉开差距的是其结果"是否有灵魂/人味儿"。Evaluator 通过 few-shot 示例校准打分尺度，确保评分一致性。

对全栈功能，评估者的反馈精确到代码行号：
控制条件：矩形填充工具允许点击拖拽填充指定区域
评估结果：FAIL — 工具只在拖拽起点和终点放置了瓷砖，未填充区域。
`fillRectangle` 函数存在但未在 mouseUp 时正确触发。

控制条件：用户可以选中并删除已放置的实体重生点
评估结果：FAIL — `LevelEditor.tsx:892` 行的 Delete 键处理器要求
`selection` 和 `selectedEntityId` 同时存在，但点击实体只设置了
`selectedEntityId`。条件应改为：
selection || (selectedEntityId && activeLayer === 'entity')

控制条件：用户可通过 API 重新排列动画帧顺序
评估结果：FAIL — `PUT /frames/reorder` 路由定义在 `/{frame_id}` 之后，
FastAPI 将 'reorder' 当作 frame_id 整数解析，返回 422 错误。
对比 OpenAI 的 Linter 报错（包含误差描述 + 修正指令），Anthropic 的评估者反馈在结构上是同构的 —— 只不过信号来源从确定性的静态分析，变成了一个独立 Agent 的动态判断。传感器的精度，决定了控制的精度。

3.3.3 控制器：Sprint Contract Criterion

OpenAI 的控制器是编码在仓库中的 golden principles 和 Linter 规则 —— 确定性的、长期稳定的判断标准。Anthropic 的控制器是另一种形态：Sprint Contract Criterion（后称“控制条件”）

在 Anthropic 的实现中，生成者不是接到规格就闷头开发 —— 每个 Sprint 开始前，生成者和评估者协商一份合约 —— 明确定义"完成"的标准。这些合约极其细粒度（例如，一个关卡编辑器的 Sprint 有 27 条验收标准），由生成者提议、评估者审核迭代，双方达成一致后才开始实施。

合约的本质是把控制目标从模糊的"把这个功能做好"转化为机械化可验证的离散条件 —— 这正是控制论要求的：参考信号必须明确、可测量。

3.3.4 执行器 + 反馈回路：对抗迭代

生成者是执行器，评估者是传感器，Sprint 合约是参考信号。

三者接通后形成的反馈回路是这样运转的：
暂时无法在飞书文档外展示此内容
每一轮迭代中，评估者用 Playwright 实际操作应用来形成判断，生成者根据反馈做出创造性的战略选择。

3.3.5 反馈回路的进化：从 Opus 4.5 到 Opus 4.6

Anthropic 在文章中披露了一个关键原则：
"Harness 的每一个组件都编码了一个关于模型局限性的假设。" 
当模型进化时，这些假设必须被重新检验。

Opus 4.5 时代的假设和对策：
  - 模型存在"上下文焦虑" —— 接近上下文窗口极限时会草率收尾
  - 需要手动上下文重置（清除上下文、通过结构化工件交接）
  - 需要 Sprint 分解将大任务拆成小步
  - 需要独立的评估者来抵抗自评偏差
Opus 4.6 的进化影响：
  - 上下文焦虑消失——可以在单个连续会话中持续工作
  - 上下文重置不再需要——Claude Agent SDK 的自动压缩足够
  - 规划能力大幅提升——可以处理更大的代码库、更长的任务链
  - 代码审查和调试能力增强

结果可见，Sprint 分解和评估者的开销可以被大幅削减。 
之前需要 Sprint 合约来约束的细粒度控制，现在模型本身的稳定性已经足以在更粗粒度上工作。

这恰恰验证了 Anthropic 自己总结的设计原则："找到最简的方案，只在需要时增加复杂度。" 在每一代新模型上，回过头来审视 Harness，剥离那些不再承重的组件，为新能力腾出空间。

3.4 OpenAI vs. Anthropic

把御二家（Gemini:?）的 Harness 放在一起看，是一个有趣的对比：
维度
OpenAI Harness
Anthropic Harness
控制架构
多层嵌套反馈回路（秒→小时→日→周）
三体对抗架构（规划者→生成者↔评估者）
核心抽象
工业控制系统
生成对抗网络（GAN）
反馈信号来源
确定性工具（Linter/CI/测试）+ Agent Review
专职评估 Agent + Playwright 实操
主观质量控制
质量文档 + 人工评分
四维评分体系 + 对抗迭代
核心创新
垃圾回收 Agent（日级自动巡检修正）
Sprint 合约（把主观标准转化为可验证条件）
但在控制论层面，它们解决的是同一个问题：如何让一个随机系统在长时间运行中保持稳定、持续逼近目标状态。 OpenAI 用多层嵌套的反馈回路在不同时间尺度上修正偏差；Anthropic 用对抗性的 Agent 间博弈，让评估压力迫使生成质量收敛。

但是殊途同归。控制论的核心 —— 稳定性来自反馈，而非前馈 —— 在两者身上都成立。

3.5 分界线

现在可以把分界线理清一下。

Context Engineering 是开环的（Open-loop）。 研发人员精心组装信息、设计 pipeline、送入模型、拿到输出。如果输出不理想，人调整输入，再来一次。系统本身没有内建的纠偏机制。

Harness Engineering 是闭环的（Closed-loop）。 系统的输出被持续测量、与期望状态比较、差异被自动修正——且这个修正不依赖人的即时介入。

[图片]

开环系统（Open-loop System）的根本问题是它无法应对扰动。闭环系统（Closed-loop System）的力量在于它能处理不确定性。即便 LLM 在某次推理中漂移了、复制了一个坏模式，多层反馈回路会在不同时间尺度上检测并修正这些偏差。所以差异不在某一次的输出质量 —— 在上下文足够好的情况下，两者这一次的输出可能完全一样。差异在于：当输出偏了的时候，第一个系统是沉默的，第二个系统会在四个不同的时间尺度上把它拉回来。

用控制论的语言做比较，相当于说：Context Engineering 优化的是单次推理的信噪比，本质上属于信号处理；Harness Engineering 优化的是系统在时间维度上的渐近稳定性，本质上属于控制工程。 前者让每一次射击更精准，后者让整个弹道在飞行全程中持续修正。这就是开环和闭环之间那道不可调和的分界。


---

4. 行业佐证

如果只有 OpenAI 和 Anthropic 两家在做这件事，那可能只是几个内部实验。但 2025 年底到 2026 年初，多个独立团队从不同方向得出了相同结论 —— 并且，他们各自触及了 Harness Engineering 的不同维度。

4.1 Vercel：约束层的减法设计

Harness 不等于"加更多控制"。有时候恰恰相反 —— 最好的 Harness 设计是拆掉多余的脚手架，让模型在干净的边界内自由操作。

Vercel 的内部 text-to-SQL Agent（d0）最初有 17 个专用工具 —— GetEntityJoins、LoadCatalog、SearchSchema、GenerateAnalysisPlan、SyntaxValidator 等等，每一个都精心设计，配合大量的 prompt engineering 和 context management。能跑，但脆弱、缓慢、需要持续维护。
"每个 edge case 意味着又一个补丁，每次模型更新意味着重新校准约束。我们花在维护脚手架上的时间比改进 Agent 本身还多。"

他们做了一个激进实验：删掉几乎所有工具，只留下一个——执行任意 bash 命令。 让 Claude 直接访问 Cube 语义层的 YAML/Markdown/JSON 文件，用 grep、cat、find、ls 自己探索信息。
指标
旧架构（17 个工具）
新架构（bash + ExecuteSQL）
变化
平均执行时间
274.8 秒
77.4 秒
快 3.5 倍
成功率
80%（4/5）
100%（5/5）
+20%
平均 token 消耗
~102K
~61K
少 37%
平均步骤数
~12 步
~7 步
少 42%
旧架构的最差案例：724 秒、100 步、145,463 token，最终失败。新架构处理同一查询：141 秒、19 步、67,483 token，成功。

这个案例说明了什么？17 个专用工具本质上是人用硬编码逻辑试图代替模型的自适应能力 —— 每增加一个工具就增加一层人为预设的路径约束，模型的探索空间被切割成碎片。删掉这些中间层，保留干净的底层基础设施（结构良好的语义层文件），模型反而能找到更短、更直接的路径。

但 Vercel 自己强调了一个关键前提：
"这只有在语义层本身就是好的文档时才有效。YAML 文件结构良好、命名一致、定义清晰。如果你的数据层是一团命名混乱、连接关系无文档的遗留代码，给 Claude 直接访问文件也救不了你——你只会更快地得到错误的查询。"
这就是 Harness 设计的第一个维度：约束层不是越多越好，而是要找到正确的抽象层级。 好的 Harness 给模型的是清晰的边界和干净的操作面，而不是一堆替模型思考的硬编码管道。

从控制论的角度看，17 个专用工具本质上是人用硬编码逻辑试图代替系统的自适应能力 —— 给一个本来就能自主探索的 Agent 加了太多手动约束，反而破坏了它的稳定性。简化 Harness、保留好的"底层基础设施"（结构化的语义层文件），让模型在清晰的边界内自由操作，才是正确的控制策略。

4.2 LangChain：闭环反馈的教科书实现

如果说 Vercel 证明了"好的约束释放模型能力"，LangChain 证明的是本文的核心论点 —— 不换模型，仅改 Harness 中的反馈回路，性能就能发生质变。

2026 年 2 月，LangChain 在 Terminal Bench 2.0（89 个任务的标准 coding agent 基准测试）上，用同一个模型（GPT-5.2-Codex），仅通过调整 harness，将 coding agent 的得分从 52.8% 提升到 66.5%（13.7 个百分点），排名从 Top 30 外跳到 Top 5。

拆开来看，他们做的每一步都能在控制论框架中找到精确的对应：

1. 传感器层：让失败可观测。 他们构建了一个 Trace Analyzer Skill —— 自动从 LangSmith 拉取实验 trace，派出多个并行分析 Agent 诊断失败原因，主 Agent 汇总发现并提出 harness 改进建议。这和 OpenAI 的垃圾回收 Agent 是同一个思路：用 Agent 来分析 Agent 的失败。不可观测的失败模式被转化为结构化的诊断信号。
2. 传感器层：消除环境盲区。 LocalContextMiddleware 在 Agent 启动时自动映射当前目录结构、扫描可用工具（如 Python 安装位置），直接注入上下文。他们发现 Agent 在试图"发现"自己的工作环境时浪费了大量步骤和 token，而且经常出错。预注入环境上下文消除了这个错误源 —— 在控制论中，这相当于提高传感器的基线精度，减少系统的观测噪声。
3. 内环反馈：强制自检。 他们发现 Agent 最常见的失败模式是"写完代码就自己读一遍确认，然后停下来"—— 没有运行测试，没有对照任务规格验证。于是加了 PreCompletionChecklistMiddleware：在 Agent 准备退出时自动拦截，强制执行一次验证 pass，对照原始 Task 规格（而非 Agent 自己的代码）检查。这是一个确定性注入的反馈回路 —— 无论 Agent 自己是否认为"完成了"，系统都会强制用外部参考值（任务规格）比较输出值（生成的代码），计算误差。和 OpenAI 的秒级 Linter 回路是同构的。
4. 阻尼器：打破振荡。 LoopDetectionMiddleware 追踪每个文件的编辑次数，当同一个文件被编辑超过 N 次时，自动注入提示："你可能需要重新考虑你的方法了。"在控制论中，这就是反馈机制 —— 当系统在某个状态附近反复振荡而不收敛时，注入额外的阻尼力，迫使系统跳出局部循环。
5. 控制策略：资源的非均匀分配。 他们发现全程使用最高推理预算（xhigh）反而得分更低（53.9%），因为 Agent 频繁超时。解决方案是"推理三明治"—— 前端规划用重度推理（xhigh）、中间实现用中等推理（high）、最终验证再回到重度推理（xhigh）。这不是反馈回路，而是控制策略层面的设计 —— 把有限的计算预算集中在系统最需要精确性的环节（规划和验证），在执行阶段降低开销。

五个改动，没有一个涉及换模型或改提示词。全部作用在 Harness 层 —— 传感器精度、反馈回路、阻尼机制、资源调度。13.7 个百分点的提升，纯粹来自控制架构的改进。

4.3 Anthropic（2025 年 11 月）：长时运行 Agent 的 Harness 设计

OpenAI 的案例和 LangChain 的案例都运行在单次会话内。但生产环境中的 Agent 面临一个更底层的约束：LLM 没有记忆。每个新会话开始时，Agent 对之前发生的事一无所知。

Anthropic 在 2025 年 11 月发布了一份关于长时运行 Agent 的 harness 设计指南，正面回应了这个问题。他们的方案是一个两阶段 harness：
- 初始化 Agent： 第一次运行时使用专门的提示词，要求模型建立初始环境——生成 init.sh脚本、创建 claude-progress.txt进度日志、做初始 git commit。关键是：生成一份详尽的 feature 需求清单（在他们的 claude.ai clone 案例中，超过 200 个 feature），全部标记为 "failing"。
- 编码 Agent： 后续每次运行，Agent 阅读进度日志和 git 历史，只选一个未完成的 feature 进行开发，完成后更新日志、commit、留下清晰的工件给下一次运行。

// 每次 session 的工作流
1. 读取 claude-progress.txt → 了解已完成/未完成的 feature
2. 查看 git log → 了解最近的变更
3. 选择一个标记为 "failing" 的 feature
4. 实现该 feature
5. 用浏览器自动化工具端到端测试
6. 更新 feature 状态为 "passing"
7. Commit + 更新 progress 日志
8. 留下环境在干净状态

这个设计的核心不是反馈回路，而是状态的外部化持久存储 —— 把控制系统正常运转所依赖的状态量（哪些 feature 完成了、当前进度在哪、上次运行留下了什么问题）从模型的上下文窗口中提取出来，写入文件系统和 git 历史。模型可以忘记一切，但控制系统的状态不会丢失。

"增量进展"（incremental progress）被证明是解决 Agent 一次性尝试构建整个应用（然后把所有东西搞砸）的关键策略。 而每次 session 只做一件事、完整地做、留下清晰的记录，这和控制论中"小步修正、持续逼近"的思想一致：不试图一次到达目标状态，而是每一步只修正一个偏差，确保每一步都是稳定的。

4.4 三个维度，一个结论

三个团队，三个不同规模，三个不同场景，各自触及了 Harness Engineering 的一个维度：

- Vercel：约束设计。
  好的 Harness 不是给模型加更多管道，而是找到正确的抽象层级，在干净的边界内释放模型的自适应能力。
- LangChain：闭环反馈。 
  不换模型、仅改反馈回路和控制策略，就能实现跨级别的性能提升。Harness 的质量比模型的质量更决定系统上限。
- Anthropic：状态管理。 
  当 Agent 需要跨越会话边界持续工作时，控制系统的状态必须外部化、持久化、增量化，不能依赖模型的记忆。

两个独立实验和前文 OpenAI、Anthropic 的实践收敛到同一个上位结论：优化 LLM 系统的稳定性和可靠性，核心杠杆不在模型本身，而在包裹模型的控制架构。 这就是 Harness Engineering 的基本命题。

但这不意味着 Context Engineering 过时了。

恰恰相反 —— 用 3.1 的映射表回看，Context Engineering 是 Harness Engineering 的一个子集——或者更准确地说，它是 Harness 的"传感器层"和"输入优化层"：动态上下文组装、渐进披露、KV-cache 优化、RAG，这些都是传感器层和输入优化层的工作，它们决定了模型每一次推理能看到什么。这部分工作不会消失，而且仍然是 Harness 质量的基础。

LangChain 在他们的博文中明确说了一句关键的话：
"Part of harness engineering is building a good delivery mechanism for context engineering."
Harness engineering 的一部分工作就是为 context engineering 构建好的交付机制。

 光有传感器不够 —— 你还需要控制器（编码在仓库中的判断标准）、执行器（Agent 的操作能力）、反馈回路（多层检测和修正机制）、以及跨会话的状态管理。CE 给了系统眼睛，HE 给了系统眼睛、手、大脑和记忆。

Harness Engineering 是 Context Engineering 的上位框架，不是它的替代品。

5. 从“In the loop”到“On the loop”

Thoughtworks 在一次关于 Gen AI 演进的报告中，提出了一个论断：
“面对智能水平日益强大的模型，人类工程师绝对不应该继续留在软件开发执行循环的内部（"In the loop"），去像一个疲惫的校对员一样逐行审查和修正 AI 生成的每一段代码；相反，人类必须实现维度的跃升，站在整个控制循环的上方（"On the loop"），成为系统的设计者和法则的制定者。”

Harness Engineering 在一定程度上终结了停留在自然语言层面的脆弱博弈。它以一种近乎冷酷的理性，诚实地面对了大型语言模型作为随机动力系统的数学本性。更为重要的是，它默契般地将传统控制理论中经过数十年工业界检验的精髓 —— 坚不可摧的机械约束、实时动态的误差微分监控、以及高频无情的闭环负反馈 —— 大规模地引入了人工智能应用的架构之中。通过构建严密的验证、强制在系统底层实施 TDD 循环、部署专门对抗系统熵增的周期性清理代理，Harness Engineering 成功地为原本狂野不羁的概率生成模型，穿上了一套钢铁般坚固的约束外壳。

一套坚不可摧的 Harness 治理系统 —— 一套能够将无序的硅基智能，通过无情的反馈闭环，稳定、高效且绝对确定地压缩成符合最高工业标准的软件工程成果的精密控制域。在这个由闭环统治的全新时代，开发者们终于可以不再卑微地“提示”模型，而是利用架构和法则，彻底“控制”整个智能系统。


Citation：
1. Ryan Lopopolo, Harness engineering: leveraging Codex in an agent-first world, OpenAI, 2026 年 2 月 11 日. https://openai.com/index/harness-engineering/
6. Andrej Karpathy, Twitter/X, 2025 年 6 月 25 日. https://x.com/karpathy/status/1937902205765607626
3. Martin Fowler, Harness Engineering, 2026 年 2 月 17 日. https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html
4. Anthropic, Effective context engineering for AI agents, 2025 年 9 月 29 日. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
5. Anthropic, Effective harnesses for long-running agents, 2025 年 11 月 26 日. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
6. LangChain, Improving Deep Agents with Harness Engineering, 2026 年 2 月 17 日. https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
7. Vercel, We removed 80% of our agent's tools, 2025 年 12 月 22 日. https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools
8. Manus, Context Engineering for AI Agents: Lessons from Building Manus, 2025 年 7 月 18 日. https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
9. 积墨AI, Harness Engineering 为什么是 Agent 时代的"控制论"？, 2026 年 3 月 19 日. https://jimo.studio/blog/harness-engineering-why-it-is-the-cybernetics-of-the-agent-era/
10. Norbert Wiener, Cybernetics: Or Control and Communication in the Animal and the Machine, MIT Press, 1948.
11. Simon Willison, Context Engineering, 2025 年 6 月 27 日. https://simonwillison.net/2025/jun/27/context-engineering/
12. LangChain, The rise of context engineering, 2025 年 6 月 23 日. https://blog.langchain.com/the-rise-of-context-engineering/
13. Gartner, 2025 年 7 月: "Context engineering is in, and prompt engineering is out."
14. 以及其他没来得及记录的 citation....