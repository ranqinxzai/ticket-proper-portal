"""The "Load IT starter set" button: common IT categories with their detail fields.

Idempotent: existing fields (by key) and categories (by name, ignoring case) are
reused, and only missing links are added — it never changes what an admin edited.
"""

from __future__ import annotations

from django.db import transaction

from ..models import AssetCategory, AssetCategoryField, AssetField, AssetFieldOption, FieldType

OS_CHOICES = [
    "Windows 11", "Windows 10", "Windows Server 2022", "Windows Server 2019", "macOS",
    "Ubuntu", "Red Hat Enterprise Linux", "Other Linux", "iOS", "Android", "Other",
]

# key → (name, type, options)
FIELDS: dict[str, tuple[str, str, list[str]]] = {
    "serial_number": ("Serial Number", FieldType.TEXT, []),
    "service_tag": ("Service Tag", FieldType.TEXT, []),
    "manufacturer": ("Manufacturer", FieldType.TEXT, []),
    "model": ("Model", FieldType.TEXT, []),
    "operating_system": ("Operating System", FieldType.DROPDOWN, OS_CHOICES),
    "processor": ("Processor", FieldType.TEXT, []),
    "ram_gb": ("RAM (GB)", FieldType.NUMBER, []),
    "storage_gb": ("Storage (GB)", FieldType.NUMBER, []),
    "hostname": ("Hostname", FieldType.TEXT, []),
    "ip_address": ("IP Address", FieldType.TEXT, []),
    "mac_address": ("MAC Address", FieldType.TEXT, []),
    "screen_size": ("Screen Size (inches)", FieldType.NUMBER, []),
    "rack_location": ("Rack Location", FieldType.TEXT, []),
    "hypervisor": ("Hypervisor", FieldType.DROPDOWN,
                   ["VMware ESXi", "Microsoft Hyper-V", "Proxmox VE", "KVM", "Other"]),
    "environment": ("Environment", FieldType.DROPDOWN,
                    ["Production", "Staging", "Development", "Disaster Recovery"]),
    "color_printing": ("Color Printing", FieldType.CHECKBOX, []),
    "toner_model": ("Toner / Cartridge Model", FieldType.TEXT, []),
    "firmware_version": ("Firmware Version", FieldType.TEXT, []),
    "port_count": ("Port Count", FieldType.NUMBER, []),
    "imei": ("IMEI", FieldType.TEXT, []),
    "phone_number": ("Phone Number", FieldType.TEXT, []),
}

# (category, [(field key, required)], [(sub-category, [(field key, required)])])
CATEGORIES = [
    ("Computer",
     [("serial_number", True), ("service_tag", False), ("manufacturer", False), ("model", False),
      ("operating_system", False), ("processor", False), ("ram_gb", False), ("storage_gb", False),
      ("hostname", False), ("mac_address", False)],
     [("Laptop", [("screen_size", False)]), ("Desktop", []), ("Workstation", [])]),
    ("Server",
     [("serial_number", False), ("service_tag", False), ("manufacturer", False), ("model", False),
      ("operating_system", True), ("processor", False), ("ram_gb", False), ("storage_gb", False),
      ("hostname", True), ("ip_address", True), ("environment", False)],
     [("Physical Server", [("serial_number", True), ("rack_location", False)]),
      ("Virtual Machine", [("hypervisor", False)])]),
    ("Printer",
     [("serial_number", True), ("manufacturer", False), ("model", False), ("ip_address", False),
      ("mac_address", False), ("color_printing", False), ("toner_model", False)],
     [("Laser", []), ("Inkjet", []), ("Multifunction", [])]),
    ("Network Device",
     [("serial_number", True), ("manufacturer", False), ("model", False), ("ip_address", False),
      ("mac_address", False), ("firmware_version", False), ("port_count", False)],
     [("Switch", []), ("Router", []), ("Firewall", []), ("Access Point", [])]),
    ("Monitor",
     [("serial_number", True), ("manufacturer", False), ("model", False), ("screen_size", False)],
     []),
    ("Mobile Device",
     [("manufacturer", False), ("model", False), ("operating_system", False), ("serial_number", False),
      ("imei", False), ("phone_number", False)],
     [("Phone", []), ("Tablet", [])]),
]


def _slug_value(label: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in label.lower()).strip("_")[:100]


@transaction.atomic
def load_starter(helpdesk) -> dict:
    counts = {"fields": 0, "categories": 0, "links": 0}
    fields: dict[str, AssetField] = {}
    for key, (name, ftype, options) in FIELDS.items():
        f = AssetField.objects.filter(helpdesk=helpdesk, key=key).first()
        if f is None:
            f = AssetField.objects.filter(helpdesk=helpdesk, name__iexact=name).first()
        if f is None:
            f = AssetField.objects.create(helpdesk=helpdesk, key=key, name=name, field_type=ftype)
            counts["fields"] += 1
            for i, label in enumerate(options):
                AssetFieldOption.objects.create(field=f, value=_slug_value(label), label=label,
                                                sort_order=i)
        fields[key] = f

    def ensure_category(name, parent, order):
        cat = AssetCategory.objects.filter(helpdesk=helpdesk, parent=parent, name__iexact=name).first()
        if cat is None:
            cat = AssetCategory.objects.create(helpdesk=helpdesk, parent=parent, name=name,
                                               sort_order=order)
            counts["categories"] += 1
        return cat

    def ensure_links(cat, links):
        for i, (key, required) in enumerate(links):
            _, created = AssetCategoryField.objects.get_or_create(
                category=cat, field=fields[key],
                defaults={"is_required": required, "sort_order": (i + 1) * 10},
            )
            counts["links"] += int(created)

    for c_order, (name, links, subs) in enumerate(CATEGORIES):
        cat = ensure_category(name, None, (c_order + 1) * 10)
        ensure_links(cat, links)
        for s_order, (sub_name, sub_links) in enumerate(subs):
            sub = ensure_category(sub_name, cat, (s_order + 1) * 10)
            ensure_links(sub, sub_links)
    return counts
