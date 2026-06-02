-- Reclassify "FAL Market Positioning Guide" as a Custom Package.
-- Custom packages use package_category matching a row in package_builder_package_types.

-- Preview current row
select package_id, package_name, package_category
from public.packages
where package_name ilike '%FAL Market Positioning Guide%';

update public.packages
set package_category = (
  select name
  from public.package_builder_package_types
  order by sort_order
  limit 1
)
where package_name ilike '%FAL Market Positioning Guide%'
  and (
    package_category is null
    or trim(package_category) = ''
    or lower(trim(package_category)) not in (
      select lower(trim(name)) from public.package_builder_package_types where trim(name) <> ''
    )
  );

-- Verify
select package_id, package_name, package_category
from public.packages
where package_name ilike '%FAL Market Positioning Guide%';
