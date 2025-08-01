import type { ChangelogEntry } from './types';

// Type for the messages object - keeping it simple since it's generated
type MessagesObject = Record<string, (...args: unknown[]) => string>;

/**
 * Get the internationalized field name for a changelog field
 */
export function getChangelogFieldName(field: string, m: MessagesObject): string {
  const fieldMap: Record<string, string> = {
    name: m.changelog_field_name(),
    type: m.changelog_field_type(),
    majorCategory: m.changelog_field_major_category(),
    natureOfRunning: m.changelog_field_nature_of_running(),
    affiliation: m.changelog_field_affiliation(),
    is985: m.changelog_field_is985(),
    is211: m.changelog_field_is211(),
    isDoubleFirstClass: m.changelog_field_is_double_first_class(),
    description: m.changelog_field_description(),
    website: m.changelog_field_website(),
    avatarUrl: m.changelog_field_avatar_url(),
    backgroundColor: m.changelog_field_background_color(),
    slug: m.changelog_field_slug(),
    campus: m.changelog_field_campus(),
    'campus.name': m.changelog_field_campus_name(),
    'campus.address': m.changelog_field_campus_address(),
    'campus.province': m.changelog_field_campus_province(),
    'campus.city': m.changelog_field_campus_city(),
    'campus.district': m.changelog_field_campus_district(),
    'campus.coordinates': m.changelog_field_campus_coordinates()
  };

  return fieldMap[field] || field;
}

/**
 * Get the internationalized action name for a changelog action
 */
export function getChangelogActionName(
  action: ChangelogEntry['action'],
  m: MessagesObject
): string {
  const actionMap: Record<string, string> = {
    created: m.changelog_action_created(),
    modified: m.changelog_action_modified(),
    deleted: m.changelog_action_deleted(),
    campus_added: m.changelog_action_campus_added(),
    campus_updated: m.changelog_action_campus_updated(),
    campus_deleted: m.changelog_action_campus_deleted()
  };

  return actionMap[action] || action;
}

/**
 * Format a changelog entry description with proper internationalization
 */
export function formatChangelogDescription(entry: ChangelogEntry, m: MessagesObject): string {
  const fieldName = getChangelogFieldName(entry.fieldInfo.field, m);
  const actionName = getChangelogActionName(entry.action, m);

  // Handle campus-specific actions
  if (entry.action === 'campus_added') {
    return m.changelog_added_campus({ campusName: entry.fieldInfo.campusName || m.unknown() });
  }

  if (entry.action === 'campus_deleted') {
    return m.changelog_deleted_campus({ campusName: entry.fieldInfo.campusName || m.unknown() });
  }

  if (entry.action === 'campus_updated') {
    return m.changelog_updated_campus({
      field: fieldName,
      campusName: entry.fieldInfo.campusName || m.unknown()
    });
  }

  // Handle regular field changes
  if (entry.oldValue && entry.newValue) {
    return m.changelog_changed_from_to({
      field: fieldName,
      oldValue: formatValue(entry.oldValue, entry.fieldInfo.field, m),
      newValue: formatValue(entry.newValue, entry.fieldInfo.field, m)
    });
  }

  if (entry.newValue && !entry.oldValue) {
    return m.changelog_set_to({
      field: fieldName,
      newValue: formatValue(entry.newValue, entry.fieldInfo.field, m)
    });
  }

  if (entry.oldValue && !entry.newValue) {
    return m.changelog_cleared({
      field: fieldName
    });
  }

  // Fallback
  return `${actionName} ${fieldName}`;
}

/**
 * Format a value for display based on field type
 */
export function formatValue(value: string, field: string, m: MessagesObject): string {
  // Handle boolean values
  if (field.startsWith('is')) {
    return value === 'true' ? m.yes() : m.no();
  }

  // Handle null/empty values
  if (!value || value === 'null') {
    return m.not_specified();
  }

  // Handle coordinates
  if (field === 'campus.coordinates') {
    return value; // Already formatted as "lat, lng"
  }

  return value;
}
