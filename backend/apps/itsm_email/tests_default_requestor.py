"""B11 (2026-10-18): the mailbox's Default requestor is readable/editable, validated, and
required when "Create the requestor" is off."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.itsm_projects.models import Project
from apps.itsm_rbac.registry import seed_rbac

from .models import EmailChannel

User = get_user_model()


def _seed_min():
    seed_rbac()
    from apps.itsm_helpdesks.seed import run as seed_helpdesks
    seed_helpdesks()
    from apps.itsm_workflows.seed import run as seed_workflows
    seed_workflows()
    from apps.itsm_groups.seed import run as seed_groups
    seed_groups()
    from apps.itsm_projects.seed import run as seed_projects
    seed_projects()


class DefaultRequestorSerializerTests(TestCase):
    def setUp(self):
        _seed_min()
        self.inc = Project.objects.get(helpdesk__key="IT", project_type="incident")
        self.inbox = User.objects.create_user(username="inbox", email="inbox@corp.com",
                                              full_name="Unknown Sender", password="x")

    def _ser(self, instance=None, **data):
        from .serializers import EmailChannelSerializer
        return EmailChannelSerializer(instance=instance, data=data, partial=instance is not None)

    def _base(self, **over):
        d = dict(name="M", address="s@itsm.local", project=str(self.inc.id))
        d.update(over)
        return d

    def test_create_with_default_and_read_detail(self):
        from .serializers import EmailChannelSerializer
        s = self._ser(**self._base(create_users=False, default_requestor=self.inbox.pk))
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        data = EmailChannelSerializer(ch).data
        self.assertEqual(data["default_requestor"], self.inbox.pk)
        self.assertEqual(data["default_requestor_detail"]["full_name"], "Unknown Sender")
        self.assertEqual(data["default_requestor_detail"]["email"], "inbox@corp.com")

    def test_off_without_default_rejected_on_create(self):
        s = self._ser(**self._base(create_users=False))
        self.assertFalse(s.is_valid())
        self.assertIn("default_requestor", s.errors)

    def test_off_without_default_rejected_on_patch_touching_it(self):
        ch = EmailChannel.objects.create(name="C", project=self.inc, address="a@itsm.local",
                                         create_users=True)
        s = self._ser(instance=ch, create_users=False)
        self.assertFalse(s.is_valid())
        self.assertIn("default_requestor", s.errors)
        # Clearing the default while off is also refused.
        ch.create_users, ch.default_requestor = False, self.inbox
        ch.save()
        s2 = self._ser(instance=ch, default_requestor=None)
        self.assertFalse(s2.is_valid())

    def test_unrelated_patch_on_legacy_bad_state_is_accepted(self):
        ch = EmailChannel.objects.create(name="C", project=self.inc, address="b@itsm.local",
                                         create_users=False, default_requestor=None)
        s = self._ser(instance=ch, name="Renamed")
        self.assertTrue(s.is_valid(), s.errors)

    def test_on_without_default_is_fine_and_clear_works(self):
        s = self._ser(**self._base(create_users=True, default_requestor=None))
        self.assertTrue(s.is_valid(), s.errors)
        ch = s.save()
        s2 = self._ser(instance=ch, default_requestor=self.inbox.pk)
        self.assertTrue(s2.is_valid(), s2.errors)
        self.assertEqual(s2.save().default_requestor_id, self.inbox.pk)
        s3 = self._ser(instance=ch, default_requestor=None)
        self.assertTrue(s3.is_valid(), s3.errors)
        self.assertIsNone(s3.save().default_requestor_id)

    def test_inactive_user_and_bots_rejected(self):
        gone = User.objects.create_user(username="gone", password="x", is_active=False)
        s = self._ser(**self._base(create_users=False, default_requestor=gone.pk))
        self.assertFalse(s.is_valid())
        self.assertIn("default_requestor", s.errors)
        from .services.system_user import get_email_bot, reset_cache
        reset_cache()
        bot = get_email_bot()
        s2 = self._ser(**self._base(create_users=False, default_requestor=bot.pk))
        self.assertFalse(s2.is_valid())
        self.assertIn("default_requestor", s2.errors)

    def test_unknown_sender_gets_default_requestor(self):
        from .services import identity
        got = identity.resolve_or_create_user("stranger@else.com", "S", create_users=False,
                                              default_requestor=self.inbox)
        self.assertEqual(got.pk, self.inbox.pk)
