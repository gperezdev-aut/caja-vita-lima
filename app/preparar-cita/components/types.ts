export type Service = {
  code: string;
  name: string;
  duration: number;
  price: number;
  category: string;
  modality: string;
  peopleMin: number;
  peopleMax: number;
  selectionRule: string;
  reservationBehavior: string;
};

export type AppointmentType = "single" | "couple" | "home" | "custom";
