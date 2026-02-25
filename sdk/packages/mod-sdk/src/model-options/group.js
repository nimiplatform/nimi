import { MODEL_TYPE_LABELS, MODEL_TYPE_ORDER } from './presets';
import { classifyModelType } from './classify';
import { filterModelOptions } from './scenario-filter';
export function groupModelOptions(models, query) {
    const filtered = filterModelOptions(models, query);
    const grouped = new Map();
    for (const model of filtered) {
        const category = classifyModelType(model);
        const bucket = grouped.get(category) || [];
        bucket.push(model);
        grouped.set(category, bucket);
    }
    return MODEL_TYPE_ORDER.map((key) => ({
        key,
        label: MODEL_TYPE_LABELS[key],
        options: grouped.get(key) || [],
    })).filter((entry) => entry.options.length > 0);
}
