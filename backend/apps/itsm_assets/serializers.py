from __future__ import annotations

import re
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.text import slugify
from rest_framework import serializers

from .models import (
    OPTION_FIELD_TYPES,
    Asset,
    AssetCategory,
    AssetCategoryField,
    AssetDocument,
    AssetEvent,
    AssetField,
    AssetFieldOption,
    AssetFieldValue,
    AssetImport,
    AssetImportRow,
    AssetStatus,
    Department,
    Location,
    StateType,
    Vendor,
)
from .services.asset_service import user_label
from .services.details import FieldResolver, field_definition, values_for
from .services.parsing import org_today

User = get_user_model()


def _ref(obj, **extra):
    if obj is None:
        return None
    return {"id": str(obj.pk), "name": obj.name, **extra}


def _user_ref(user):
    if user is None:
        return None
    return {"id": user.pk, "username": user.username, "full_name": user_label(user),
            "email": user.email or ""}


def _unique_name(model, name, *, instance=None, label="name", **scope):
    qs = model.objects.filter(name__iexact=name, **scope)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError(f"Another {label} is already called “{name}”.")


def _clean_name(value, *, max_len):
    name = " ".join(str(value or "").split())
    if not name:
        raise serializers.ValidationError("Enter a name.")
    if len(name) > max_len:
        raise serializers.ValidationError(f"Keep it under {max_len} characters.")
    return name


def unique_key(model, base: str, *, max_len=60, **scope) -> str:
    base = (slugify(base) or "item")[: max_len - 4].replace("-", "_")
    key, n = base, 1
    while model.objects.filter(key=key, **scope).exists():
        n += 1
        key = f"{base}_{n}"
    return key


# ── Statuses ──────────────────────────────────────────────────────────────────

class AssetStatusSerializer(serializers.ModelSerializer):
    state_type_label = serializers.CharField(source="get_state_type_display", read_only=True)
    asset_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = AssetStatus
        fields = ["id", "name", "key", "state_type", "state_type_label", "color", "description",
                  "sort_order", "is_default", "auto_expire_target", "asset_count"]
        read_only_fields = ["key"]
        # The partial "only one" constraints are kept by save() moving the flag, so
        # DRF's auto-generated unique validators must not refuse the request.
        extra_kwargs = {"is_default": {"validators": []}, "auto_expire_target": {"validators": []}}

    def validate_name(self, value):
        name = _clean_name(value, max_len=60)
        _unique_name(AssetStatus, name, instance=self.instance, label="status")
        return name

    def validate_color(self, value):
        if value and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise serializers.ValidationError("Use a colour like #2563eb.")
        return value or "#64748b"

    def validate(self, attrs):
        state = attrs.get("state_type", getattr(self.instance, "state_type", None))
        target = attrs.get("auto_expire_target", getattr(self.instance, "auto_expire_target", False))
        if target and state != StateType.RETIRED:
            raise serializers.ValidationError(
                {"auto_expire_target": ["Only a Retired-type status can be the Expired target."]})
        if self.instance is not None and self.instance.is_default and attrs.get("is_default") is False:
            raise serializers.ValidationError(
                {"is_default": ["Make another status the default instead."]})
        return attrs

    @transaction.atomic
    def save(self, **kwargs):
        if self.instance is None:
            name = self.validated_data["name"]
            kwargs.setdefault("key", unique_key(AssetStatus, name))
        if self.validated_data.get("is_default"):
            AssetStatus.objects.filter(is_default=True).exclude(
                pk=getattr(self.instance, "pk", None)).update(is_default=False)
        if self.validated_data.get("auto_expire_target"):
            AssetStatus.objects.filter(auto_expire_target=True).exclude(
                pk=getattr(self.instance, "pk", None)).update(auto_expire_target=False)
        return super().save(**kwargs)


# ── Vendors / Locations / Departments ────────────────────────────────────────

class _MasterSerializer(serializers.ModelSerializer):
    asset_count = serializers.IntegerField(read_only=True, default=0)
    label = "item"

    def validate_name(self, value):
        name = _clean_name(value, max_len=150)
        _unique_name(self.Meta.model, name, instance=self.instance, label=self.label)
        return name


class VendorSerializer(_MasterSerializer):
    label = "vendor"

    class Meta:
        model = Vendor
        fields = ["id", "name", "contact_person", "email", "phone", "website", "address", "notes",
                  "is_active", "asset_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class LocationSerializer(_MasterSerializer):
    label = "location"

    class Meta:
        model = Location
        fields = ["id", "name", "code", "address", "is_active", "asset_count", "created_at",
                  "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class DepartmentSerializer(_MasterSerializer):
    label = "department"

    class Meta:
        model = Department
        fields = ["id", "name", "code", "is_active", "asset_count", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


# ── Categories & fields ──────────────────────────────────────────────────────

class AssetCategoryFieldSerializer(serializers.ModelSerializer):
    field_name = serializers.CharField(source="field.name", read_only=True)
    field_key = serializers.CharField(source="field.key", read_only=True)
    field_type = serializers.CharField(source="field.field_type", read_only=True)
    field_is_active = serializers.BooleanField(source="field.is_active", read_only=True)

    class Meta:
        model = AssetCategoryField
        fields = ["id", "category", "field", "field_name", "field_key", "field_type",
                  "field_is_active", "is_required", "sort_order"]
        validators: list = []  # validate() gives the readable "already linked" message

    def validate(self, attrs):
        category = attrs.get("category", getattr(self.instance, "category", None))
        field = attrs.get("field", getattr(self.instance, "field", None))
        if self.instance is not None:
            if "category" in attrs and attrs["category"].pk != self.instance.category_id:
                raise serializers.ValidationError({"category": ["Remove the link and add a new one."]})
            if "field" in attrs and attrs["field"].pk != self.instance.field_id:
                raise serializers.ValidationError({"field": ["Remove the link and add a new one."]})
        if category is not None and field is not None:
            if category.is_deleted or field.is_deleted:
                raise serializers.ValidationError("That category or field was deleted.")
            if category.helpdesk_id != field.helpdesk_id:
                raise serializers.ValidationError(
                    {"field": ["That field belongs to another helpdesk."]})
            if self.instance is None and AssetCategoryField.objects.filter(
                    category=category, field=field).exists():
                raise serializers.ValidationError(
                    {"field": [f"“{field.name}” is already linked to “{category.name}”."]})
        return attrs


class AssetCategorySerializer(serializers.ModelSerializer):
    asset_count = serializers.IntegerField(read_only=True, default=0)
    field_links = serializers.SerializerMethodField()

    class Meta:
        model = AssetCategory
        fields = ["id", "helpdesk", "parent", "name", "description", "sort_order", "is_active",
                  "asset_count", "field_links", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_field_links(self, obj):
        links = getattr(obj, "_prefetched_links", None)
        if links is None:
            links = obj.field_links.select_related("field").filter(field__is_deleted=False)
        return AssetCategoryFieldSerializer(links, many=True).data

    def validate_name(self, value):
        return _clean_name(value, max_len=100)

    def validate(self, attrs):
        inst = self.instance
        helpdesk = attrs.get("helpdesk", getattr(inst, "helpdesk", None))
        parent = attrs.get("parent", getattr(inst, "parent", None))
        if inst is not None:
            if "helpdesk" in attrs and attrs["helpdesk"].pk != inst.helpdesk_id:
                raise serializers.ValidationError({"helpdesk": ["A category can't move to another helpdesk."]})
            if "parent" in attrs and (attrs["parent"].pk if attrs["parent"] else None) != inst.parent_id:
                raise serializers.ValidationError({"parent": [
                    "A category can't change level or move to another category. "
                    "Create it again where you need it."]})
        if parent is not None:
            if parent.is_deleted or parent.helpdesk_id != getattr(helpdesk, "pk", None):
                raise serializers.ValidationError({"parent": ["That category isn't in this helpdesk."]})
            if parent.parent_id is not None:
                raise serializers.ValidationError({"parent": [
                    f"“{parent.name}” is already a sub-category. Only two levels are allowed."]})
        name = attrs.get("name", getattr(inst, "name", None))
        if name and helpdesk is not None:
            qs = AssetCategory.objects.filter(helpdesk=helpdesk, parent=parent, name__iexact=name)
            if inst is not None:
                qs = qs.exclude(pk=inst.pk)
            if qs.exists():
                where = f"under “{parent.name}”" if parent else "at the top level"
                raise serializers.ValidationError({"name": [f"“{name}” already exists {where}."]})
        return attrs


class AssetFieldOptionSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False, allow_null=True)
    value = serializers.CharField(max_length=100, required=False, allow_blank=True)
    label = serializers.CharField(max_length=150)
    sort_order = serializers.IntegerField(required=False, min_value=0, default=0)
    is_active = serializers.BooleanField(required=False, default=True)


class AssetFieldSerializer(serializers.ModelSerializer):
    options = serializers.SerializerMethodField()
    options_input = AssetFieldOptionSerializer(many=True, required=False, write_only=True,
                                               source="options_write")
    used_by = serializers.SerializerMethodField()
    value_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = AssetField
        fields = ["id", "helpdesk", "key", "name", "field_type", "help_text", "is_active", "options",
                  "options_input", "used_by", "value_count", "created_at", "updated_at"]
        read_only_fields = ["key", "created_at", "updated_at"]

    def get_options(self, obj):
        return [{"id": str(o.id), "value": o.value, "label": o.label, "sort_order": o.sort_order,
                 "is_active": o.is_active}
                for o in obj.options.filter(is_deleted=False).order_by("sort_order", "label")]

    def get_used_by(self, obj):
        out = []
        for link in obj.category_links.select_related("category__parent").filter(
                category__is_deleted=False):
            c = link.category
            out.append({"category_id": str(c.id),
                        "name": f"{c.parent.name} › {c.name}" if c.parent else c.name,
                        "is_required": link.is_required})
        return out

    def validate_name(self, value):
        return _clean_name(value, max_len=120)

    def validate(self, attrs):
        inst = self.instance
        helpdesk = attrs.get("helpdesk", getattr(inst, "helpdesk", None))
        if inst is not None and "helpdesk" in attrs and attrs["helpdesk"].pk != inst.helpdesk_id:
            raise serializers.ValidationError({"helpdesk": ["A field can't move to another helpdesk."]})
        name = attrs.get("name", getattr(inst, "name", None))
        if name and helpdesk is not None:
            qs = AssetField.objects.filter(helpdesk=helpdesk, name__iexact=name)
            if inst is not None:
                qs = qs.exclude(pk=inst.pk)
            if qs.exists():
                raise serializers.ValidationError({"name": [f"A field called “{name}” already exists."]})
        ftype = attrs.get("field_type", getattr(inst, "field_type", None))
        if inst is not None and "field_type" in attrs and attrs["field_type"] != inst.field_type \
                and AssetFieldValue.objects.filter(field=inst).exists():
            raise serializers.ValidationError({"field_type": [
                "Assets already have values for this field, so its type can't change. "
                "Create a new field instead."]})
        options = attrs.get("options_write")
        if options and ftype not in OPTION_FIELD_TYPES:
            raise serializers.ValidationError({"options_input": ["Only dropdown and multi-select fields have options."]})
        if options:
            labels = [" ".join(o["label"].split()).lower() for o in options if o.get("is_active", True)]
            if len(labels) != len(set(labels)):
                raise serializers.ValidationError({"options_input": ["Two options have the same label."]})
        return attrs

    def _save_options(self, field, options):
        if options is None:
            return
        existing = {o.id: o for o in field.options.filter(is_deleted=False)}
        keep = set()
        taken = {o.value.lower() for o in existing.values()}
        for i, data in enumerate(options):
            label = " ".join(data["label"].split())
            oid = data.get("id")
            if oid and oid in existing:
                opt = existing[oid]
                opt.label, opt.sort_order = label, data.get("sort_order", i)
                opt.is_active = data.get("is_active", True)
                opt.save()  # the stored value never changes: assets reference it
                keep.add(oid)
                continue
            value = (data.get("value") or "").strip() or (slugify(label).replace("-", "_") or "option")
            base, n = value[:96], 1
            while value.lower() in taken:
                n += 1
                value = f"{base}_{n}"
            taken.add(value.lower())
            opt = AssetFieldOption.objects.create(field=field, value=value, label=label,
                                                  sort_order=data.get("sort_order", i),
                                                  is_active=data.get("is_active", True))
            keep.add(opt.id)
        for oid, opt in existing.items():
            if oid not in keep:
                opt.soft_delete()

    @transaction.atomic
    def create(self, validated_data):
        options = validated_data.pop("options_write", None)
        validated_data["key"] = unique_key(AssetField, validated_data["name"], max_len=80,
                                           helpdesk=validated_data["helpdesk"])
        field = super().create(validated_data)
        self._save_options(field, options)
        return field

    @transaction.atomic
    def update(self, instance, validated_data):
        options = validated_data.pop("options_write", None)
        field = super().update(instance, validated_data)
        self._save_options(field, options)
        return field


# ── Assets ────────────────────────────────────────────────────────────────────

class AssetListSerializer(serializers.ModelSerializer):
    category = serializers.SerializerMethodField()
    sub_category = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    vendor = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    assigned_user = serializers.SerializerMethodField()

    class Meta:
        model = Asset
        fields = ["id", "helpdesk", "asset_tag", "name", "category", "sub_category", "status",
                  "vendor", "location", "department", "assigned_user", "purchase_date",
                  "purchase_cost", "expiry_date", "warranty_expiry_date", "created_at", "updated_at"]

    def get_category(self, obj):
        return _ref(obj.category)

    def get_sub_category(self, obj):
        return _ref(obj.sub_category)

    def get_status(self, obj):
        return _ref(obj.status, color=obj.status.color, state_type=obj.status.state_type)

    def get_vendor(self, obj):
        return _ref(obj.vendor)

    def get_location(self, obj):
        return _ref(obj.location)

    def get_department(self, obj):
        return _ref(obj.department)

    def get_assigned_user(self, obj):
        return _user_ref(obj.assigned_user)


class AssetDetailSerializer(AssetListSerializer):
    details = serializers.SerializerMethodField()
    detail_fields = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    updated_by = serializers.SerializerMethodField()
    source_import = serializers.SerializerMethodField()
    expiry_passed = serializers.SerializerMethodField()

    class Meta(AssetListSerializer.Meta):
        fields = AssetListSerializer.Meta.fields + [
            "allotment_notes", "allotted_at", "details", "detail_fields", "created_by",
            "updated_by", "source_import", "expiry_passed"]

    def _effective(self, obj):
        if not hasattr(obj, "_eff_fields"):
            obj._eff_fields = FieldResolver(obj.helpdesk_id).for_category(
                obj.category_id, obj.sub_category_id)
        return obj._eff_fields

    def get_details(self, obj):
        values = values_for(obj)
        return {e.key: values.get(e.key) for e in self._effective(obj)}

    def get_detail_fields(self, obj):
        return [field_definition(e) for e in self._effective(obj)]

    def get_created_by(self, obj):
        return _user_ref(obj.created_by)

    def get_updated_by(self, obj):
        return _user_ref(obj.updated_by)

    def get_source_import(self, obj):
        imp = obj.source_import
        return {"id": str(imp.id), "file_name": imp.file_name} if imp else None

    def get_expiry_passed(self, obj):
        return bool(obj.expiry_date and obj.expiry_date < org_today())


class _PK(serializers.PrimaryKeyRelatedField):
    """A PK field whose 'not found' message is readable."""

    default_error_messages = {
        "does_not_exist": "That item doesn't exist (it may have been deleted).",
        "incorrect_type": "That item doesn't exist.",
    }


class AssetWriteSerializer(serializers.Serializer):
    helpdesk = serializers.CharField(required=False)
    name = serializers.CharField(required=False, allow_blank=True, max_length=400)
    asset_tag = serializers.CharField(required=False, allow_blank=True, max_length=200)
    category = _PK(queryset=AssetCategory.objects.all(), required=False, allow_null=True)
    sub_category = _PK(queryset=AssetCategory.objects.all(), required=False, allow_null=True)
    status = _PK(queryset=AssetStatus.objects.all(), required=False, allow_null=True)
    vendor = _PK(queryset=Vendor.objects.all(), required=False, allow_null=True)
    location = _PK(queryset=Location.objects.all(), required=False, allow_null=True)
    department = _PK(queryset=Department.objects.all(), required=False, allow_null=True)
    assigned_user = _PK(queryset=User.objects.all(), required=False, allow_null=True)
    allotment_notes = serializers.CharField(required=False, allow_blank=True)
    purchase_date = serializers.DateField(required=False, allow_null=True)
    purchase_cost = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"),
                                             required=False, allow_null=True)
    expiry_date = serializers.DateField(required=False, allow_null=True)
    warranty_expiry_date = serializers.DateField(required=False, allow_null=True)
    details = serializers.DictField(required=False, allow_null=True)


class AssetEventSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display", read_only=True)
    actor = serializers.SerializerMethodField()

    class Meta:
        model = AssetEvent
        fields = ["id", "action", "action_label", "actor", "changes", "note", "created_at"]

    def get_actor(self, obj):
        return _user_ref(obj.actor)


class AssetDocumentSerializer(serializers.ModelSerializer):
    """A document row. No file URL: files download only through the authenticated
    ``documents/{id}/download/`` action."""

    doc_type_label = serializers.CharField(source="get_doc_type_display", read_only=True)
    uploaded_by = serializers.SerializerMethodField()

    class Meta:
        model = AssetDocument
        fields = ["id", "doc_type", "doc_type_label", "original_name", "size_bytes", "content_type",
                  "note", "uploaded_by", "created_at"]

    def get_uploaded_by(self, obj):
        return _user_ref(obj.uploaded_by)


class AssetImportSerializer(serializers.ModelSerializer):
    created_by = serializers.SerializerMethodField()

    class Meta:
        model = AssetImport
        fields = ["id", "helpdesk", "file_name", "total_rows", "created_count", "failed_count",
                  "expired_count", "created_masters", "warnings", "created_by", "created_at"]

    def get_created_by(self, obj):
        return _user_ref(obj.created_by)


class AssetImportRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetImportRow
        fields = ["id", "row_number", "data", "errors"]
