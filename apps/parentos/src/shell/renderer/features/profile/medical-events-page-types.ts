import type { ChildProfile } from '../../app-shell/app-store.js';

export type MedicalEventsChildContext = Pick<
  ChildProfile,
  'childId' | 'birthDate' | 'displayName' | 'gender'
>;

export type MedicalEventsFormMedication = {
  name: string;
  dose: string;
  unit: string;
  frequency: string;
  days: string;
  tags: string[];
};
