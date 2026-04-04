export type DiningPreferenceCategoryId =
  | 'dietaryRestrictions'
  | 'tabooIngredients'
  | 'flavorPreferences'
  | 'cuisinePreferences';

export type DiningPreferenceOption = {
  value: string;
  label: string;
};

export type DiningPreferenceGroup = {
  id: DiningPreferenceCategoryId;
  title: string;
  description: string;
  options: DiningPreferenceOption[];
};

export const DINING_PREFERENCE_GROUPS: DiningPreferenceGroup[] = [
  {
    id: 'dietaryRestrictions',
    title: '忌口',
    description: '先记住你平时就不会吃的东西，后面推荐时直接避开。',
    options: [
      { value: 'no_beef', label: '不吃牛肉' },
      { value: 'no_lamb', label: '不吃羊肉' },
      { value: 'no_pork', label: '不吃猪肉' },
      { value: 'no_offal', label: '不吃内脏' },
      { value: 'no_seafood', label: '不吃海鲜' },
      { value: 'no_raw_food', label: '不吃生食' },
      { value: 'no_dairy', label: '不吃乳制品' },
      { value: 'no_spicy', label: '不吃辣' },
    ],
  },
  {
    id: 'tabooIngredients',
    title: '指定不要',
    description: '适合记录你特别介意的配料或食材。',
    options: [
      { value: 'no_coriander', label: '不要香菜' },
      { value: 'no_scallion', label: '不要葱' },
      { value: 'no_garlic', label: '不要蒜' },
      { value: 'no_onion', label: '不要洋葱' },
      { value: 'no_ginger', label: '不要姜' },
      { value: 'no_peanut', label: '不要花生' },
      { value: 'no_tree_nut', label: '不要坚果' },
      { value: 'no_mushroom', label: '不要菌菇' },
    ],
  },
  {
    id: 'flavorPreferences',
    title: '口味偏好',
    description: '这些会作为后续点菜建议时的加权参考。',
    options: [
      { value: 'prefer_light', label: '更喜欢清淡' },
      { value: 'prefer_fresh', label: '更喜欢鲜口' },
      { value: 'prefer_sour', label: '更喜欢酸口' },
      { value: 'prefer_sweet', label: '更喜欢甜口' },
      { value: 'prefer_spicy', label: '更喜欢香辣' },
      { value: 'prefer_ma_la', label: '更喜欢麻辣' },
      { value: 'prefer_chargrill', label: '更喜欢炭火香' },
      { value: 'prefer_crispy', label: '更喜欢脆口' },
    ],
  },
  {
    id: 'cuisinePreferences',
    title: '常找菜系',
    description: '先把你更常搜的方向记下来，后面可以直接参与筛选和推荐。',
    options: [
      { value: 'cuisine_yue', label: '粤菜' },
      { value: 'cuisine_chuan', label: '川菜' },
      { value: 'cuisine_xiang', label: '湘菜' },
      { value: 'cuisine_hotpot', label: '火锅' },
      { value: 'cuisine_bbq', label: '烧烤' },
      { value: 'cuisine_noodles', label: '面食' },
      { value: 'cuisine_japanese', label: '日料' },
      { value: 'cuisine_brunch', label: '早午餐' },
    ],
  },
];
