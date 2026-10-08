import { useMemo } from 'react';
import { SelectField } from '@nimiplatform/kit/ui';

// ISO 3166-1 alpha-2 values; Intl supplies the localized country/region names.
const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);

// SelectField drops empty-string options (Radix reserves '' for the
// placeholder), so the "not specified" choice uses a sentinel value.
const UNSPECIFIED_VALUE = '__unspecified__';

export function ProfileCountryField(input: {
  label: string;
  emptyLabel: string;
  value: string;
  locale: string;
  onChange: (value: string) => void;
}) {
  const value = input.value.trim().toUpperCase();
  const options = useMemo(() => {
    const names = new Intl.DisplayNames([input.locale], { type: 'region' });
    const collator = new Intl.Collator(input.locale);
    const countryOptions = COUNTRY_CODES.map((code) => ({ value: code, label: names.of(code) || code }))
      .sort((left, right) => collator.compare(left.label, right.label));
    const allOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: UNSPECIFIED_VALUE, label: input.emptyLabel },
      ...countryOptions,
    ];
    if (value && !COUNTRY_CODES.includes(value)) {
      allOptions.push({ value, label: value, disabled: true });
    }
    return allOptions;
  }, [input.locale, input.emptyLabel, value]);

  return (
    <div className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">{input.label}</span>
      <SelectField
        aria-label={input.label}
        name="country"
        className="mt-1.5"
        selectClassName="text-sm"
        options={options}
        value={value || UNSPECIFIED_VALUE}
        onValueChange={(next) => input.onChange(next === UNSPECIFIED_VALUE ? '' : next)}
      />
    </div>
  );
}
