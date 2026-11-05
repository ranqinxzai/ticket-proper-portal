"""Re-point a project's automation rules after its workflow is copied (2026-10-18).

"Make a copy for this project" (``itsm_workflows.services.cloner``) gives the project a
NEW workflow whose statuses/transitions have new ids. Rules store those ids, so without
this they'd silently stop matching new tickets. Called inside the clone transaction.

Only that project's live rules are touched, and only ids that belong to the OLD
workflow are rewritten:
  • ``triggers[status_changed].config.from_status_ids / to_status_ids`` — by status key;
  • ``conditions.conditions[*]`` on ``field == "status"`` — by status key;
  • ``actions[transition].config.transition_id`` — by transition name + from-status
    key (or create/global) + to-status key.
An id that can't be matched is KEPT (dropping a status id would widen a trigger to
"any status") and reported. Tickets still on the old workflow (rule 10) no longer match
status-specific triggers / transition actions of the re-pointed rules.
"""

from __future__ import annotations


def _status_label(st):
    return f"“{st.name}”" if st is not None else "(deleted status)"


def repoint_project_rules(project, old_wf, new_wf) -> dict:
    from apps.itsm_workflows.models import Status, Transition

    from ..models import AutomationRule

    old_statuses = {str(s.id): s for s in Status.all_objects.filter(workflow=old_wf)}
    new_by_key = {s.key: s for s in Status.objects.filter(workflow=new_wf)}
    status_map = {sid: str(new_by_key[s.key].id) for sid, s in old_statuses.items()
                  if s.key in new_by_key}

    def tr_sig(t):
        return (t.name, t.from_status.key if t.from_status_id else None,
                bool(t.is_global), t.to_status.key)

    old_trs = {str(t.id): t for t in Transition.all_objects.filter(workflow=old_wf)
               .select_related("from_status", "to_status")}
    new_trs = {}
    for t in Transition.objects.filter(workflow=new_wf).select_related("from_status", "to_status"):
        new_trs.setdefault(tr_sig(t), t)

    repointed, unmatched = 0, []
    for rule in AutomationRule.objects.filter(project=project, is_deleted=False):
        changed = False

        def map_status(sid, rule=rule):
            nonlocal changed
            sid = str(sid)
            if sid not in old_statuses:
                return sid  # not the old workflow's — leave alone
            if sid in status_map:
                changed = True
                return status_map[sid]
            unmatched.append(f"Rule “{rule.name}”: status {_status_label(old_statuses[sid])} "
                             "has no match in the copy")
            return sid

        triggers = []
        for trig in rule.triggers or []:
            trig = dict(trig)
            if trig.get("type") == "status_changed":
                cfg = dict(trig.get("config") or {})
                for k in ("from_status_ids", "to_status_ids"):
                    if cfg.get(k):
                        cfg[k] = [map_status(x) for x in cfg[k]]
                trig["config"] = cfg
            triggers.append(trig)

        conditions = dict(rule.conditions or {})
        if conditions.get("conditions"):
            new_conds = []
            for c in conditions["conditions"]:
                c = dict(c)
                if c.get("field") == "status" and c.get("value") not in (None, ""):
                    v = c["value"]
                    c["value"] = [map_status(x) for x in v] if isinstance(v, list) else map_status(v)
                new_conds.append(c)
            conditions["conditions"] = new_conds

        actions = []
        for a in rule.actions or []:
            a = dict(a)
            if a.get("type") == "transition":
                cfg = dict(a.get("config") or {})
                tid = str(cfg.get("transition_id") or "")
                old_t = old_trs.get(tid)
                if old_t is not None:
                    match = new_trs.get(tr_sig(old_t)) if not old_t.is_deleted else None
                    if match is not None:
                        cfg["transition_id"] = str(match.id)
                        changed = True
                    else:
                        src = old_t.from_status.name if old_t.from_status_id else "(create)"
                        unmatched.append(f"Rule “{rule.name}”: transition “{old_t.name}” "
                                         f"({src} → {old_t.to_status.name}) has no match in the copy")
                a["config"] = cfg
            actions.append(a)

        if changed:
            rule.triggers, rule.conditions, rule.actions = triggers, conditions, actions
            rule.save(update_fields=["triggers", "conditions", "actions", "updated_at"])
            repointed += 1
    return {"repointed": repointed, "unmatched": unmatched}
