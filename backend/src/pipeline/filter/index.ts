export type FilterType = 'contains' | 'starts_with' | 'ends_with' | 'extension' | 'regex';

export interface FilterRule {
  type: FilterType;
  value: string;
  isInclude: boolean; 
}

export class URLFilter {
  rules: FilterRule[];

  constructor(rules: FilterRule[]) {
    this.rules = rules;
  }

  isAllowed(url: string): boolean {
    const includes = this.rules.filter(r => r.isInclude);
    const excludes = this.rules.filter(r => !r.isInclude);

    // 1. If ANY exclude rule matches, reject immediately.
    for (const rule of excludes) {
      if (this.matches(url, rule)) return false; 
    }

    // 2. Group include rules by their type.
    // If you add multiple "extensions" (like .png and .jpg), it will act as an OR.
    // But if you mix "extension" and "contains", it will act as an AND.
    if (includes.length > 0) {
      const groupedIncludes = includes.reduce((acc, rule) => {
        acc[rule.type] = acc[rule.type] || [];
        acc[rule.type].push(rule);
        return acc;
      }, {} as Record<string, FilterRule[]>);

      for (const type in groupedIncludes) {
        const rulesForType = groupedIncludes[type];
        const matchesAnyInGroup = rulesForType.some(rule => this.matches(url, rule));
        
        // If it fails to match ANY rule in this group, it's rejected.
        if (!matchesAnyInGroup) return false;
      }
    }

    return true; 
  }

  private matches(urlStr: string, rule: FilterRule): boolean {
    const lowerUrl = urlStr.toLowerCase();
    const lowerVal = rule.value.toLowerCase();

    switch (rule.type) {
      case 'contains': 
        return lowerUrl.includes(lowerVal);
      case 'starts_with': 
        return lowerUrl.startsWith(lowerVal);
      case 'ends_with': 
        return lowerUrl.endsWith(lowerVal);
      case 'extension': 
        const ext = rule.value.startsWith('.') ? rule.value : `.${rule.value}`;
        try {
          const parsed = new URL(urlStr);
          return parsed.pathname.toLowerCase().endsWith(ext.toLowerCase());
        } catch {
          return false;
        }
      case 'regex':
        try {
          return new RegExp(rule.value, 'i').test(urlStr);
        } catch {
          return false;
        }
      default:
        return false;
    }
  }
}
