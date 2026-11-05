from django.contrib import admin

from .models import Asset, AssetCategory, AssetField, AssetImport, AssetStatus, Department, Location, Vendor

for model in (Asset, AssetCategory, AssetField, AssetImport, AssetStatus, Department, Location, Vendor):
    admin.site.register(model)
