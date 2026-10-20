#!/usr/bin/env python3
"""Stdlib regressions for protocol delivery, record templates and host hooks."""

import importlib.util
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PLUGIN = REPO_ROOT / "plugin"
SCRIPTS = PLUGIN / "hooks" / "scripts"
PROGRESS_SKILL = PLUGIN / "skills" / "update-progress" / "SKILL.md"
RULE = PLUGIN / "rules" / "agentic-protocol-core.mdc"
HOSTS = ("cursor", "codex", "codebuddy")

# The agent reads PROGRESS.md itself, so these headings are a linking and resume
# convention rather than a hook contract. The template still has to name them
# consistently, or links and recovery guidance drift apart.
RESUME_SECTIONS = ("Objective", "Constraints", "Current State", "Next Check")
HISTORY_SECTIONS = ("Milestones", "Deferred")
# Objective owns the primary goal; parallel goals and subgoals retain their own
# criteria. Switching focus does not close them.
OPEN_GOAL_SECTIONS = ("Other Goals",)
CLOSED_GOAL_SECTIONS = ("Closed Questions",)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sc = load("session-context")
hp = load("hook_payload")


def record(**sections):
    return "# Project Progress\n" + "".join(
        f"\n## {name.replace('_', ' ')}\n{value}\n" for name, value in sections.items()
    )


def headings(text):
    return {line[3:].strip() for line in text.splitlines() if line.startswith("## ")}


FULL_PROGRESS = record(
    Objective="Choose a retrieval method using measured recall and latency.",
    Constraints="Keep the dataset fixed; no external upload.",
    Current_State="Pilot implemented, but quality and latency remain unmeasured. No blocker.",
    Next_Check="Measure the pilot; select it only if both criteria pass, otherwise compare B.",
    Milestones="2026-09-16 — Pilot built; [evidence](worklog/2026-09-16.md#pilot).",
    Deferred="Broader survey; revisit only if both candidates fail.",
)


class ProjectCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.project = pathlib.Path(self.tmp.name)
        self.folder = self.project / ".agent-context"
        self.folder.mkdir()

    def put(self, name, text):
        (self.folder / name).write_text(text, encoding="utf-8")

    def run_session(self, host, **payload):
        payload.setdefault("workspace_root", str(self.project))
        payload.setdefault("cwd", str(self.project))
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "session-context.py"), host],
            input=json.dumps(payload), capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)


class ProtocolDelivery(ProjectCase):
    def test_only_codex_receives_the_protocol(self):
        self.put("PROGRESS.md", FULL_PROGRESS)
        for host in HOSTS:
            with self.subTest(host=host):
                payload = self.run_session(host)
                if host == "codex":
                    message = payload["hookSpecificOutput"]["additionalContext"]
                    self.assertIn("[Agentic 方法论]", message)
                    self.assertIn("# Agentic 方法论", message)
                else:
                    self.assertEqual(payload, {})

    def test_protocol_body_excludes_frontmatter(self):
        message = sc.build_message("codex")
        self.assertNotIn("alwaysApply", message)
        self.assertNotIn("description:", message)
        self.assertIn("## Project Memory", message)

    def test_work_record_is_never_injected(self):
        self.put("PROGRESS.md", FULL_PROGRESS)
        for host in HOSTS:
            with self.subTest(host=host):
                message = json.dumps(self.run_session(host))
                self.assertNotIn("Choose a retrieval method", message)
                self.assertNotIn("quality and latency remain unmeasured", message)
                self.assertNotIn("Source: .agent-context/", message)

    def test_hook_never_reads_or_writes_the_work_record(self):
        self.put("PROGRESS.md", FULL_PROGRESS)
        before = {path: path.read_bytes() for path in self.folder.rglob("*") if path.is_file()}
        for host in HOSTS:
            with patch.object(pathlib.Path, "iterdir", side_effect=AssertionError("No record scan")), \
                 patch.object(pathlib.Path, "glob", side_effect=AssertionError("No record glob")):
                sc.build_message(host)
        self.assertEqual({path: path.read_bytes() for path in self.folder.rglob("*") if path.is_file()}, before)

    def test_missing_context_directory_is_not_an_error(self):
        self.folder.rmdir()
        for host in HOSTS:
            with self.subTest(host=host):
                payload = self.run_session(host)
                self.assertEqual(payload == {}, host != "codex")
        self.assertFalse(self.folder.exists())

    def test_unreadable_rule_emits_a_no_op(self):
        with patch.object(sc, "PROTOCOL_PATH", self.project / "absent.mdc"):
            self.assertEqual(sc.build_message("codex"), "")
        output = io.StringIO()
        with redirect_stdout(output):
            sc.emit("")
        self.assertEqual(json.loads(output.getvalue()), {})


class HookRegistration(unittest.TestCase):
    def test_hosts_with_a_rules_slot_register_no_session_start(self):
        cursor = json.loads((PLUGIN / "hooks" / "hooks.json").read_text())
        codebuddy = json.loads((PLUGIN / "hooks" / "codebuddy-hooks.json").read_text())
        self.assertNotIn("sessionStart", cursor["hooks"])
        self.assertNotIn("SessionStart", codebuddy["hooks"])
        self.assertEqual(sc.INJECT_PROTOCOL_HOSTS, frozenset({"codex"}))

    def test_codex_registers_session_start_for_the_protocol(self):
        config = json.loads((PLUGIN / "hooks" / "codex-hooks.json").read_text())
        hooks = config["hooks"]["SessionStart"][0]["hooks"]
        self.assertEqual(len(hooks), 1)
        self.assertIn("session-context.py", hooks[0]["command"])

    def test_codebuddy_hook_commands_use_correct_host_and_root(self):
        data = json.loads((PLUGIN / "hooks" / "codebuddy-hooks.json").read_text())
        for matchers in data["hooks"].values():
            for matcher in matchers:
                for hook in matcher["hooks"]:
                    self.assertIn(" codebuddy", hook["command"])
                    self.assertIn("${CODEBUDDY_PLUGIN_ROOT}", hook["command"])


class Contracts(ProjectCase):
    def template(self, index=0):
        skill = PROGRESS_SKILL.read_text(encoding="utf-8")
        return skill.split("```markdown\n")[1:][index].split("```", 1)[0]

    def test_template_partitions_resume_and_history(self):
        self.assertEqual(
            headings(self.template()),
            set(RESUME_SECTIONS) | set(HISTORY_SECTIONS) | set(OPEN_GOAL_SECTIONS) | set(CLOSED_GOAL_SECTIONS),
        )

    def test_daily_template_is_evidence_not_a_second_state_map(self):
        skill = PROGRESS_SKILL.read_text(encoding="utf-8")
        self.assertEqual(len(skill.split("```markdown\n")[1:]), 2)
        daily = self.template(1)
        self.assertTrue(daily.startswith("# Work Log — YYYY-MM-DD"))
        self.assertIn("## Pilot", daily)
        self.assertTrue(headings(daily).isdisjoint(RESUME_SECTIONS))

    def test_parallel_goal_template_keeps_ownership_and_acceptance(self):
        section = self.template().split("## Other Goals\n", 1)[1].split("\n## ", 1)[0]
        for field in ("所属", "验收标准", "状态", "链接"):
            with self.subTest(field=field):
                self.assertIn(field, section)

    def test_closed_question_template_does_not_equate_switching_with_closure(self):
        section = self.template().split("## Closed Questions\n", 1)[1].split("\n## ", 1)[0]
        self.assertNotIn("被取代", section)
        self.assertIn("明确放弃", section)
        self.assertIn("适用条件", section)
        self.assertIn("所属目标", section)
        self.assertIn("有效验收标准", section)

    def test_progress_instructions_do_not_skip_evidence_on_unchanged_state(self):
        skill = PROGRESS_SKILL.read_text(encoding="utf-8")
        instructions = skill.split("## Instructions\n", 1)[1].split("\n## ", 1)[0]
        self.assertNotIn("状态未变则不写文件", instructions)
        self.assertNotIn("无新结论的重复检查", skill)
        self.assertIn("独立判断", instructions)
        self.assertIn("worklog", instructions)
        self.assertIn("PROGRESS.md", instructions)

    def test_external_writes_are_recorded_even_without_state_change(self):
        body = RULE.read_text(encoding="utf-8")
        criteria = PROGRESS_SKILL.read_text(encoding="utf-8").split("## Write criteria\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("外部写操作不适用微小改动豁免", body)
        self.assertIn("尝试过外部写操作", body)
        for text in (body, criteria):
            for outcome in ("成功、失败、无变化或结果未知", "目标对象", "请求值", "验证依据"):
                with self.subTest(outcome=outcome):
                    self.assertIn(outcome, text)

    def test_closeout_keeps_log_and_map_writes_independent(self):
        memory = RULE.read_text(encoding="utf-8").split("## Project Memory\n", 1)[1]
        self.assertIn("独立判断", memory)
        self.assertIn("仅地图字段或相关链接变化时更新", memory)
        self.assertNotIn("更新 worklog 和 `PROGRESS.md`", memory)

    def test_durable_corrections_are_not_gated_by_task_size(self):
        body = RULE.read_text(encoding="utf-8")
        startup = body.split("## Startup\n", 1)[1].split("\n## ", 1)[0]
        for trigger in ("用户纠正", "被证伪假设", "实测不符"):
            self.assertIn(trigger, startup)
        memory = body.split("## Project Memory\n", 1)[1]
        self.assertIn("每回合最终回复前", memory)
        self.assertIn("影响后续工作的用户纠正", memory)
        self.assertIn("就地更正其知识归属文件", memory)
        self.assertIn("不重复存放", memory)

    def test_domain_knowledge_is_discovered_before_work_and_captured_unprompted(self):
        # Agents default to solving only the current request; reusable domain
        # knowledge must have an owner, a read moment and a capture trigger.
        body = RULE.read_text(encoding="utf-8")
        startup = body.split("## Startup\n", 1)[1].split("\n## ", 1)[0]
        memory = body.split("## Project Memory\n", 1)[1]
        self.assertIn("可复用的领域知识", startup)
        # Only newly confirmed knowledge triggers a write; a recalled fact does not.
        self.assertIn("新确认", startup)
        self.assertIn("切换领域", startup)
        # A checklist read only at task start is forgotten by the time of the action.
        self.assertIn("关键动作前", startup)
        self.assertIn("`knowledge/`", startup)
        self.assertIn("避开已知失败", startup)
        self.assertIn("| `knowledge/<domain>.md` |", memory)
        closeout = memory.split("**回合收尾**", 1)[1]
        for guard in ("用户未要求也", "成功做法", "来源、适用范围与证据强度", "不写成通用规律"):
            with self.subTest(guard=guard):
                self.assertIn(guard, closeout)
        # The always-on rule names kinds of knowledge, never one domain's case.
        for case_specific in ("pcvr", "广告", "论文", "消融", "wide", "obsidian"):
            self.assertNotIn(case_specific, body.lower(), case_specific)

    def test_bootstrap_owns_domain_knowledge_quality(self):
        skill = (PLUGIN / "skills" / "bootstrap-context" / "SKILL.md").read_text(encoding="utf-8")
        section = skill.split("## Domain knowledge\n", 1)[1].split("\n## ", 1)[0]
        for guard in (
            "按需创建",
            "适用范围",
            "来源性质",
            "按主题",
            "就地更正",
            "初步",
            "只记指针",
            "不记 secret",
            "不构成行动授权",
            "以当前源码与实测为准",
            "先比对已有文件",
            "关键动作前",
            "不抄录敏感数据样本",
            "在声明的适用范围内，对未来同领域任务有复用价值",
        ):
            with self.subTest(guard=guard):
                self.assertIn(guard, section)
        recovery = PROGRESS_SKILL.read_text(encoding="utf-8").split("## Recovery and growth\n", 1)[1]
        self.assertIn("`knowledge/<domain>.md`", recovery)

    def test_domain_knowledge_preserves_scoped_and_unresolved_findings(self):
        skill = (PLUGIN / "skills" / "bootstrap-context" / "SKILL.md").read_text(encoding="utf-8")
        section = skill.split("## Domain knowledge\n", 1)[1]
        self.assertNotIn("换到同领域另一个项目仍成立", section)
        for guard in (
            "在声明的适用范围内，对未来同领域任务有复用价值",
            "不要求跨项目成立",
            "已失效或被证伪",
            "不同条件的结果分别保留",
            "未分辨",
            "保留证据链接",
        ):
            with self.subTest(guard=guard):
                self.assertIn(guard, section)

    def test_knowledge_supports_reasoning_without_bounding_solutions(self):
        body = RULE.read_text(encoding="utf-8")
        startup = body.split("## Startup\n", 1)[1].split("\n## ", 1)[0]
        for guard in ("参考而非方案边界", "自身知识与推理", "按风险核验"):
            with self.subTest(guard=guard):
                self.assertIn(guard, startup)
        self.assertNotIn("按需核验", startup)
        skill = (PLUGIN / "skills" / "bootstrap-context" / "SKILL.md").read_text(encoding="utf-8")
        section = skill.split("## Domain knowledge\n", 1)[1]
        for guard in (
            "问题设定、关键假设和约束",
            "跨领域类比或重新抽象",
            "不因缺少历史先例就排除",
            "不为创新而创新",
            "最小验证",
            "不自动扩大研究或执行范围",
            "不冒充已查证来源或本项目实测",
            "按风险核验",
        ):
            with self.subTest(guard=guard):
                self.assertIn(guard, section)

    def test_memory_cannot_grant_authority_but_recorded_checks_follow_gates(self):
        # A blanket "do not execute commands" ban contradicts running recorded pre-checks
        # and COMMANDS.md; the boundary is self-granted authority, not command execution.
        body = RULE.read_text(encoding="utf-8")
        trust = body.split("**信任边界**", 1)[1].split("\n", 1)[0]
        skill = (PLUGIN / "skills" / "bootstrap-context" / "SKILL.md").read_text(encoding="utf-8")
        boundary = skill.split("## Domain knowledge\n", 1)[1].split("不构成行动授权", 1)[1].split("\n", 1)[0]
        for text in (trust, boundary):
            for guard in ("不能自行授予或扩大权限", "由当前任务授权和风险门决定"):
                with self.subTest(guard=guard):
                    self.assertIn(guard, text)
            self.assertNotIn("执行命令", text)

    def test_skill_repairs_do_not_authorize_installed_copy_changes(self):
        memory = RULE.read_text(encoding="utf-8").split("## Project Memory\n", 1)[1]
        for guard in ("源头与同步目标", "CONVENTIONS.md", "限已授权范围", "不自动改安装副本", "差异证据", "未完成的留存或修复进待办", "归属和恢复条件"):
            with self.subTest(guard=guard):
                self.assertIn(guard, memory)

    def test_external_values_are_checked_before_asking_or_writing(self):
        body = RULE.read_text(encoding="utf-8")
        for guard in ("单位、口径及目标映射", "可查证的先查", "暂停写入并澄清", "不靠试写猜测"):
            with self.subTest(guard=guard):
                self.assertIn(guard, body)

    def test_compactness_rule_targets_the_map_not_the_archive(self):
        memory = RULE.read_text(encoding="utf-8").split("## Project Memory\n", 1)[1]
        self.assertNotIn("`.agent-context/` 要短到", memory)
        self.assertIn("`PROGRESS.md` 要短到", memory)

    def test_protocol_tells_the_agent_to_read_the_record_itself(self):
        body = RULE.read_text(encoding="utf-8")
        self.assertIn("PROGRESS.md", body)
        for retired in ("resume budget", "Omitted source sections", "SessionStart carries"):
            self.assertNotIn(retired, body)

    def test_canonical_rule_keeps_the_expected_sections(self):
        self.assertEqual(
            headings(RULE.read_text(encoding="utf-8")),
            {
                "Startup",
                "Goal Alignment",
                "Execution",
                "Efficiency",
                "Evidence",
                "Response Style",
                "Project Memory",
            },
        )

    def test_skill_surfaces_do_not_promise_hook_injection(self):
        for path in list((PLUGIN / "skills").rglob("*.md")) + [PLUGIN / "README.md"]:
            text = path.read_text(encoding="utf-8")
            for retired in ("SessionStart carries", "resume budget", "Over-budget"):
                self.assertNotIn(retired, text, str(path))

    def test_codex_context_fits_host_limit(self):
        config = json.loads((PLUGIN / "hooks" / "codex-hooks.json").read_text())
        limit = config["hooks"]["SessionStart"][0]["hooks"][0]["additionalContextLimit"]
        self.assertIs(type(limit), int)
        self.assertGreater(limit, 0)
        # Codex approx_token_count: codex-rs/utils/string/src/truncate.rs (2026-09-17).
        approx_tokens = (len(sc.build_message("codex").encode("utf-8")) + 3) // 4
        self.assertLessEqual(approx_tokens, limit)

    def test_every_skill_is_registered_where_the_host_needs_it(self):
        # Cursor and Codex point at the skills directory, but CodeBuddy lists each
        # SKILL.md explicitly: an unregistered skill silently never loads there.
        manifest = json.loads(
            (PLUGIN / ".codebuddy-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        listed = set(manifest["skills"])
        for skill in sorted(p for p in (PLUGIN / "skills").iterdir() if p.is_dir()):
            self.assertIn(f"./skills/{skill.name}/SKILL.md", listed, skill.name)

    def test_inference_clauses_stay_domain_neutral(self):
        # The clauses exist because a research incident, but they must read for
        # software/experience/ops work too: no domain vocabulary in the always-on rule.
        body = RULE.read_text(encoding="utf-8")
        for clause in (
            "未检出差异不是等价",
            "重复现象不是根因",
            "证据不足写未分辨",
            "先核对自己传入的标识",
            "不得比来源证据更确定",
        ):
            self.assertIn(clause, body, clause)
        for domain_specific in ("seed", "p 值", "AUC", "baseline", "Bonferroni"):
            self.assertNotIn(domain_specific, body, domain_specific)

    def test_review_is_risk_triggered_and_not_self_certifying(self):
        skill = (PLUGIN / "skills" / "run-review" / "SKILL.md").read_text(encoding="utf-8")
        # Reviewing a summary only proves internal consistency; the incident that
        # motivated this skill was lost detail between artifact and summary.
        self.assertIn("不得只给结论摘要", skill)
        # A gate with no off-condition turns into ceremony, which the lightweight
        # boundary in CONVENTIONS.md forbids.
        self.assertIn("## Gates", skill)
        self.assertIn("### 不触发", skill)
        # "It was reviewed" is not a finding.
        self.assertIn("不能作为结论成立的证据", skill)
        self.assertIn("未检查项", skill)
        self.assertIn("run-review", RULE.read_text(encoding="utf-8"))

    def test_review_reaches_dispatch_and_closure_not_just_preparation(self):
        # Preparing a briefing is not a review: the skill must carry the whole
        # run, and must say what happens when the host cannot delegate at all.
        skill = (PLUGIN / "skills" / "run-review" / "SKILL.md").read_text(encoding="utf-8")
        body = RULE.read_text(encoding="utf-8")
        for step in ("实际派出", "取得报告", "未独立复核", "不得用自查冒充"):
            self.assertIn(step, skill, step)
        # A reviewer who cannot judge against the goal can only check internal
        # consistency, and an unbounded reviewer chain is a cost defect.
        self.assertIn("目标与验收标准", skill)
        self.assertIn("复核者不再往下派复核者", skill)
        # Adopting a finding is not resolving it.
        self.assertIn("## 修复与关闭", skill)
        self.assertIn("已采纳", skill)
        self.assertIn("宿主支持委派时实际派出", body)

    def test_lifecycle_risk_includes_known_downstream_consequences(self):
        body = RULE.read_text(encoding="utf-8")
        execution = body.split("## Execution\n", 1)[1].split("\n## ", 1)[0]
        review = next(line for line in execution.splitlines() if "按风险做一次独立复核" in line)
        self.assertIn("当前操作及已知后续使用的后果", review)
        self.assertIn("不以当前一步可重做作为豁免依据", review)
        self.assertNotIn("生效前不会再经人", review)
        for case_specific in ("定时", "触发器", "上传顺序"):
            self.assertNotIn(case_specific, review, case_specific)

    def test_effective_downstream_check_changes_timing_not_risk_exemption(self):
        skill = (PLUGIN / "skills" / "run-review" / "SKILL.md").read_text(encoding="utf-8")
        gates = skill.split("## Gates\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("有效后续核对只用于安排复核时机或避免重复复核", gates)
        self.assertIn("生效前执行", gates)
        self.assertIn("实际生效产物", gates)
        self.assertIn("覆盖相关风险", gates)
        self.assertIn("发现问题能阻止生效", gates)
        self.assertIn("未覆盖的风险仍按需复核", gates)
        self.assertIn("不能假定用户会检查", gates)
        self.assertIn("不能以自查替代独立复核", gates)
        g1 = next(line for line in gates.splitlines() if line.startswith("| G1 "))
        self.assertIn("影响面大", g1)
        self.assertIn("或使这些后果可以发生的动作前", g1)
        self.assertNotIn("产物交出", gates)
        self.assertIn("可逆、便宜、影响面小的改动", gates)
        self.assertIn("简单问答与只读状态查询", gates)

    def test_prior_authorization_does_not_retire_the_pre_execution_gate(self):
        # A plan approved but not yet executed was the recorded gap: an agent could
        # decide the "before approval" moment had passed and skip straight to a
        # post-hoc check, which cannot undo spend or irreversible effects.
        skill = (PLUGIN / "skills" / "run-review" / "SKILL.md").read_text(encoding="utf-8")
        gates = skill.split("## Gates", 1)[1].split("## ", 1)[0]
        self.assertNotIn("方案获批前", gates)
        self.assertIn("执行开始前", gates)
        self.assertIn("用户已授权也适用", gates)
        self.assertIn("G3 不能替代必要的 G1", gates)
        # The cheapness ranking is reasoning, not a measurement, and must say so.
        self.assertIn("未实测", gates)
        self.assertIn("用户已授权不替代复核", RULE.read_text(encoding="utf-8"))

    def test_retraction_does_not_require_proving_the_opposite(self):
        # Symmetric evidence for a retraction would freeze a known-bad claim in
        # place; withdrawing an unsupported claim and asserting its negation are
        # different acts. Equally, a failed call must stay recordable as unknown.
        body = RULE.read_text(encoding="utf-8")
        self.assertIn("原据不成立即可撤回", body)
        self.assertIn("断言反面结论要有新证据", body)
        self.assertNotIn("撤回与降级同样是结论，需同等证据", body)
        self.assertIn("原因未知", body)

    def test_deliverables_keep_clean_final_state_and_mermaid_diagrams(self):
        body = RULE.read_text(encoding="utf-8")
        execution = body.split("## Execution\n", 1)[1].split("\n## ", 1)[0]
        for clause in (
            "干净的终态设计",
            "不残留对话中被撤回的错误",
            "有复发风险的被证伪假设仅归入 `worklog/`、`MEMORY.md` 或对应 `knowledge/` 文件",
        ):
            with self.subTest(clause=clause):
                self.assertIn(clause, execution)
        style = body.split("## Response Style\n", 1)[1].split("\n## ", 1)[0]
        self.assertIn("需要画图时用 Mermaid，不用 ASCII art", style)

    def test_scripted_file_edits_must_surface_the_change_set(self):
        # Direct edits prefer the IDE/harness dedicated file-edit or patch tool
        # so the diff remains visible to the user.
        body = RULE.read_text(encoding="utf-8")
        execution = body.split("## Execution\n", 1)[1].split("\n## ", 1)[0]
        for clause in ("直接编辑优先用 IDE/harness 提供的专用文件编辑或补丁工具", "diff对用户可见"):
            with self.subTest(clause=clause):
                self.assertIn(clause, execution)

    def test_retired_workflow_is_not_advertised(self):
        self.assertFalse((PLUGIN / "skills" / "handoff").exists())
        surfaces = list((PLUGIN / "skills").rglob("*.md")) + [REPO_ROOT / "README.md", PLUGIN / "README.md"]
        for path in surfaces:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("/handoff", text, str(path))
            for line in text.splitlines():
                if "touched files" in line.lower():
                    # The prohibition may be written in either language; what the
                    # contract requires is that any mention forbids the retired field
                    # rather than advertises it.
                    self.assertTrue(
                        "do not list touched files" in line.lower()
                        or "不列 touched files" in line,
                        str(path),
                    )
        for path in (PLUGIN / "hooks").glob("*.json"):
            self.assertNotIn("handoff", path.read_text(), str(path))


class PackagingContracts(ProjectCase):
    def setUp(self):
        super().setUp()
        shutil.copytree(REPO_ROOT / "plugin", self.project / "plugin",
                        ignore=shutil.ignore_patterns("__pycache__"))
        self.package = self.project / "plugin"

    def validate(self):
        if not shutil.which("node"):
            self.skipTest("Node.js is required for packaging validation")
        result = subprocess.run(
            ["node", str(REPO_ROOT / "scripts" / "validate-template.mjs")],
            cwd=self.project, capture_output=True, text=True, timeout=30,
        )
        return result.returncode, result.stdout + result.stderr

    def test_repository_ships_one_plugin_package_and_no_marketplace_index(self):
        # Installation goes through install-local.sh only; a marketplace index at
        # the repository root is what made CodeBuddy load the rule from source.
        self.assertTrue((REPO_ROOT / "plugin" / "rules" / "agentic-protocol-core.mdc").is_file())
        self.assertFalse((REPO_ROOT / "plugins").exists())
        for leftover in (".cursor-plugin", ".codebuddy-plugin", ".agents"):
            self.assertFalse((REPO_ROOT / leftover).exists(), leftover)

    def test_rejects_each_host_manifest_version_drift(self):
        for host in HOSTS:
            path = self.package / f".{host}-plugin" / "plugin.json"
            original = path.read_text()
            with self.subTest(host=host):
                data = json.loads(original)
                data["version"] = "9.0.0"
                path.write_text(json.dumps(data))
                code, output = self.validate()
                self.assertNotEqual(code, 0, output)
                self.assertIn("version mismatch", output.lower())
            path.write_text(original)

    def test_coordinated_plugin_version_change_passes(self):
        for host in HOSTS:
            path = self.package / f".{host}-plugin" / "plugin.json"
            data = json.loads(path.read_text())
            data["version"] = "0.2.1"
            path.write_text(json.dumps(data))
        code, output = self.validate()
        self.assertEqual(code, 0, output)

    def write_rule(self, total_chars, always_applied=True):
        """Rewrite the canonical rule to an exact whole-file character count."""
        path = self.package / "rules" / "agentic-protocol-core.mdc"
        original = path.read_text(encoding="utf-8")
        head = original[:original.index("---", 3) + 3]
        if not always_applied:
            head = head.replace("alwaysApply: true", "alwaysApply: false")
        head += "\n\n# Agentic 方法论\n\n"
        self.assertLess(len(head), total_chars)
        path.write_text(head + "x" * (total_chars - len(head)), encoding="utf-8")
        self.assertEqual(len(path.read_text(encoding="utf-8")), total_chars)

    def test_rejects_always_applied_rule_over_host_injection_limit(self):
        # CodeBuddy drops an over-budget rule silently (support, 2026-09-18), so
        # only a failing check can prevent shipping a protocol that never loads.
        self.write_rule(6001)
        code, output = self.validate()
        self.assertNotEqual(code, 0, output)
        self.assertIn("host injection limit", output.lower())

    def test_accepts_always_applied_rule_at_the_host_injection_limit(self):
        self.write_rule(6000)
        code, output = self.validate()
        self.assertEqual(code, 0, output)

    def test_warns_before_the_host_injection_limit_without_failing(self):
        self.write_rule(5900)
        code, output = self.validate()
        self.assertEqual(code, 0, output)
        self.assertIn("100 below", output)

    def test_on_demand_rule_is_not_bound_by_the_injection_limit(self):
        self.write_rule(9000, always_applied=False)
        code, output = self.validate()
        self.assertEqual(code, 0, output)
        self.assertNotIn("host injection limit", output.lower())

    def test_shipped_rules_stay_within_the_host_injection_limit(self):
        self.assertLessEqual(len(RULE.read_text(encoding="utf-8")), 6000)

    @unittest.skipIf(os.name == "nt", "Local installer requires Bash")
    def test_install_excludes_generated_files_without_touching_sources_or_other_plugins(self):
        scripts = self.project / "scripts"
        scripts.mkdir()
        installer = scripts / "install-local.sh"
        shutil.copy2(REPO_ROOT / "scripts" / "install-local.sh", installer)
        generated = ("hooks/scripts/__pycache__/old.pyc", "hooks/scripts/orphan.pyc",
                     "hooks/scripts/orphan.pyo", ".DS_Store", ".plugins-cache.json", ".plugins-cache.json.bak")
        for name in generated:
            path = self.package / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("generated fixture")
        home = self.project / "test home"
        unrelated = home / ".cursor/plugins/local/unrelated/keep.txt"
        unrelated.parent.mkdir(parents=True)
        unrelated.write_text("keep")
        result = subprocess.run(
            ["bash", str(installer), "cursor"], cwd=self.project,
            env=dict(os.environ, HOME=str(home)), capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        installed = home / ".cursor/plugins/local/agentic-protocol"
        for name in generated:
            self.assertFalse((installed / name).exists(), name)
            self.assertEqual((self.package / name).read_text(), "generated fixture")
        self.assertFalse((installed / "hooks/scripts/__pycache__").exists())
        self.assertEqual(unrelated.read_text(), "keep")
        for name in ("rules/agentic-protocol-core.mdc", "hooks/scripts/session-context.py", "README.md"):
            self.assertEqual((installed / name).read_bytes(), (self.package / name).read_bytes())

    @unittest.skipIf(os.name == "nt", "Local installer requires Bash")
    def test_codebuddy_plugin_source_stays_inside_its_marketplace(self):
        scripts = self.project / "scripts"
        scripts.mkdir()
        shutil.copy2(REPO_ROOT / "scripts" / "install-local.sh", scripts / "install-local.sh")
        home = self.project / "test home"
        official = home / ".codebuddy/plugins/marketplaces/codebuddy-plugins-official/plugins/pdf/keep.txt"
        official.parent.mkdir(parents=True)
        official.write_text("keep")
        legacy_plugin = home / ".codebuddy/plugins/agentic-protocol/rules/old.mdc"
        legacy_market = home / ".codebuddy/plugin-marketplaces/agentic-protocol-marketplace/old.json"
        legacy_plugin.parent.mkdir(parents=True)
        legacy_market.parent.mkdir(parents=True)
        legacy_plugin.write_text("old")
        legacy_market.write_text("old")
        registry = home / ".codebuddy/plugins/known_marketplaces.json"
        registry.write_text(json.dumps({
            "codebuddy-plugins-official": {
                "installLocation": str(official.parents[2]),
            },
            "agent-context-marketplace": {"installLocation": "/tmp/gone"},
        }) + "\n")
        result = subprocess.run(
            ["bash", str(scripts / "install-local.sh"), "codebuddy"], cwd=self.project,
            env=dict(os.environ, HOME=str(home)), capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        marketplace = home / ".codebuddy/plugins/marketplaces/agentic-protocol-marketplace"
        installed = marketplace / "plugins/agentic-protocol"
        manifest = json.loads((marketplace / ".codebuddy-plugin/marketplace.json").read_text())
        source = manifest["plugins"][0]["source"]
        self.assertEqual(source, "./plugins/agentic-protocol")
        resolved = (marketplace / source).resolve()
        self.assertEqual(resolved, installed.resolve())
        self.assertTrue(marketplace.resolve() in resolved.parents)
        self.assertEqual(
            (installed / "rules/agentic-protocol-core.mdc").read_bytes(),
            (self.package / "rules/agentic-protocol-core.mdc").read_bytes(),
        )
        self.assertFalse(legacy_plugin.exists())
        self.assertFalse((home / ".codebuddy/plugin-marketplaces").exists())
        self.assertEqual(official.read_text(), "keep")
        recorded = json.loads(registry.read_text())
        self.assertEqual(recorded["codebuddy-plugins-official"]["installLocation"], str(official.parents[2]))
        self.assertNotIn("agent-context-marketplace", recorded)
        self.assertEqual(
            recorded["agentic-protocol-marketplace"]["installLocation"],
            str(marketplace.resolve()),
        )


class VersionLockstep(unittest.TestCase):
    """VERSION is the single source of truth; a hand-edited manifest must fail."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        shutil.copytree(REPO_ROOT / "plugin", self.root / "plugin",
                        ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(REPO_ROOT / "dsh", self.root / "dsh",
                        ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
        shutil.copy(REPO_ROOT / "VERSION", self.root / "VERSION")

    def bump(self, *args):
        return subprocess.run(
            [str(REPO_ROOT / "scripts" / "bump-version.sh"), *args, "--root", str(self.root)],
            capture_output=True, text=True, timeout=30,
        )

    def test_shipped_repository_is_in_lockstep(self):
        result = self.bump("--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_manifest_drift_fails_the_check(self):
        manifest = self.root / "plugin" / ".codex-plugin" / "plugin.json"
        data = json.loads(manifest.read_text())
        data["version"] = "9.9.9"
        manifest.write_text(json.dumps(data))
        result = self.bump("--check")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("9.9.9", result.stdout)

    def test_dsh_manifest_drift_fails_the_check(self):
        manifest = self.root / "dsh" / "package.json"
        data = json.loads(manifest.read_text())
        data["version"] = "9.9.9"
        manifest.write_text(json.dumps(data))
        result = self.bump("--check")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("9.9.9", result.stdout)

    def test_bump_rewrites_version_and_every_manifest(self):
        result = self.bump("3.1.4")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / "VERSION").read_text().strip(), "3.1.4")
        for host in HOSTS:
            data = json.loads((self.root / "plugin" / f".{host}-plugin" / "plugin.json").read_text())
            self.assertEqual(data["version"], "3.1.4", host)
        dsh_manifest = json.loads((self.root / "dsh" / "package.json").read_text())
        self.assertEqual(dsh_manifest["version"], "3.1.4", "dsh")
        self.assertEqual(self.bump("--check").returncode, 0)


class HostDispatch(unittest.TestCase):
    def test_unknown_host_is_rejected(self):
        with self.assertRaises(SystemExit):
            hp.parse_host(["session-context.py", "claude"])

    def test_all_hosts_are_known(self):
        for host in HOSTS:
            self.assertEqual(hp.parse_host(["x", host]), host)

    def test_session_envelope_is_claude_style(self):
        output = io.StringIO()
        with redirect_stdout(output):
            sc.emit("protocol text")
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["hookSpecificOutput"]["additionalContext"], "protocol text")
        self.assertEqual(payload["hookSpecificOutput"]["hookEventName"], "SessionStart")

    def test_non_injecting_host_prints_a_no_op(self):
        """A host that loads the rule itself must get `{}` and exit 0, never an error."""
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "session-context.py"), "cursor"],
            input="", capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
