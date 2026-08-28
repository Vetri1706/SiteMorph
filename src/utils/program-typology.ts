import type { BuildingTypology } from "../types";

export interface TypologyZoneTemplate {
  id: string;
  name: string;
  ratio: number;
  role: "primary" | "secondary" | "support";
}

export interface BuildingTypologyProfile {
  key: BuildingTypology;
  label: string;
  zones: TypologyZoneTemplate[];
  upperLevelLabel: string;
  operations: {
    edgeLabel: string;
    itemLabel: string;
    shelteredBandLabel: string;
    shelteredBandDepthFt: number;
    outdoorZoneLabel: string;
    outdoorZoneDepthFt: number;
  };
}

const profiles: Record<BuildingTypology, BuildingTypologyProfile> = {
  logistics: {
    key: "logistics",
    label: "Logistics / industrial",
    zones: [
      { id: "warehouse", name: "Warehouse / operations hall", ratio: 0.84, role: "primary" },
      { id: "staging", name: "Staging / dispatch", ratio: 0.12, role: "secondary" },
      { id: "service-core", name: "Service / utility core", ratio: 0.04, role: "support" },
    ],
    upperLevelLabel: "Office / administration upper level",
    operations: { edgeLabel: "North loading edge", itemLabel: "loading dock", shelteredBandLabel: "Shaded loading canopy", shelteredBandDepthFt: 18, outdoorZoneLabel: "Truck court / maneuvering zone", outdoorZoneDepthFt: 120 },
  },
  healthcare: {
    key: "healthcare",
    label: "Healthcare",
    zones: [
      { id: "clinical-care", name: "Clinical care / departments", ratio: 0.42, role: "primary" },
      { id: "diagnostics", name: "Diagnostics / treatment", ratio: 0.25, role: "secondary" },
      { id: "public-admin", name: "Public / administration", ratio: 0.18, role: "secondary" },
      { id: "clinical-support", name: "Clinical support / building services", ratio: 0.15, role: "support" },
    ],
    upperLevelLabel: "Upper-level clinical / administration program",
    operations: { edgeLabel: "North patient and emergency arrival", itemLabel: "service bay", shelteredBandLabel: "Covered patient / ambulance arrival", shelteredBandDepthFt: 30, outdoorZoneLabel: "Emergency access / patient drop-off", outdoorZoneDepthFt: 60 },
  },
  office: {
    key: "office",
    label: "Office / workplace",
    zones: [
      { id: "workspace", name: "Workplace / tenant area", ratio: 0.55, role: "primary" },
      { id: "collaboration", name: "Meeting / collaboration", ratio: 0.2, role: "secondary" },
      { id: "amenities", name: "Reception / amenities", ratio: 0.15, role: "secondary" },
      { id: "service-core", name: "Vertical circulation / services", ratio: 0.1, role: "support" },
    ],
    upperLevelLabel: "Upper-level workplace program",
    operations: { edgeLabel: "North main arrival", itemLabel: "service bay", shelteredBandLabel: "Shaded pedestrian entry", shelteredBandDepthFt: 18, outdoorZoneLabel: "Arrival forecourt / fire access", outdoorZoneDepthFt: 40 },
  },
  education: {
    key: "education",
    label: "Education",
    zones: [
      { id: "learning", name: "Classrooms / learning areas", ratio: 0.45, role: "primary" },
      { id: "shared-learning", name: "Shared learning / library", ratio: 0.2, role: "secondary" },
      { id: "assembly", name: "Assembly / dining / activity", ratio: 0.15, role: "secondary" },
      { id: "admin-service", name: "Administration / services", ratio: 0.2, role: "support" },
    ],
    upperLevelLabel: "Upper-level learning program",
    operations: { edgeLabel: "North student arrival", itemLabel: "service bay", shelteredBandLabel: "Covered student entry", shelteredBandDepthFt: 20, outdoorZoneLabel: "Bus / parent drop-off and fire access", outdoorZoneDepthFt: 80 },
  },
  residential: {
    key: "residential",
    label: "Residential",
    zones: [
      { id: "residential-units", name: "Residential units", ratio: 0.7, role: "primary" },
      { id: "circulation", name: "Circulation / shared access", ratio: 0.15, role: "secondary" },
      { id: "amenities", name: "Resident amenities", ratio: 0.1, role: "secondary" },
      { id: "service-core", name: "Building services", ratio: 0.05, role: "support" },
    ],
    upperLevelLabel: "Upper-level residential program",
    operations: { edgeLabel: "North resident arrival", itemLabel: "service bay", shelteredBandLabel: "Covered lobby / resident entry", shelteredBandDepthFt: 18, outdoorZoneLabel: "Pick-up / service and fire access", outdoorZoneDepthFt: 40 },
  },
  hotel: {
    key: "hotel",
    label: "Hotel / hospitality",
    zones: [
      { id: "guest-program", name: "Guest rooms / accommodation", ratio: 0.62, role: "primary" },
      { id: "lobby-fb", name: "Lobby / food and beverage", ratio: 0.18, role: "secondary" },
      { id: "back-of-house", name: "Back of house", ratio: 0.12, role: "support" },
      { id: "circulation", name: "Circulation / building services", ratio: 0.08, role: "support" },
    ],
    upperLevelLabel: "Upper-level guest-room program",
    operations: { edgeLabel: "North guest and service arrival", itemLabel: "service bay", shelteredBandLabel: "Porte-cochère / covered arrival", shelteredBandDepthFt: 30, outdoorZoneLabel: "Guest drop-off / service court", outdoorZoneDepthFt: 60 },
  },
  retail: {
    key: "retail",
    label: "Retail",
    zones: [
      { id: "sales", name: "Sales / customer area", ratio: 0.65, role: "primary" },
      { id: "stock", name: "Stock / fulfillment", ratio: 0.15, role: "secondary" },
      { id: "customer-support", name: "Customer support / circulation", ratio: 0.1, role: "secondary" },
      { id: "service-core", name: "Service / utility core", ratio: 0.1, role: "support" },
    ],
    upperLevelLabel: "Upper-level retail / administration program",
    operations: { edgeLabel: "North customer and service edge", itemLabel: "service bay", shelteredBandLabel: "Shaded storefront / customer entry", shelteredBandDepthFt: 18, outdoorZoneLabel: "Customer forecourt / service access", outdoorZoneDepthFt: 50 },
  },
  "mixed-use": {
    key: "mixed-use",
    label: "Mixed-use",
    zones: [
      { id: "primary-program", name: "Primary occupied program", ratio: 0.4, role: "primary" },
      { id: "public-commercial", name: "Public / commercial program", ratio: 0.25, role: "secondary" },
      { id: "shared-program", name: "Shared amenities / circulation", ratio: 0.2, role: "secondary" },
      { id: "service-core", name: "Vertical circulation / services", ratio: 0.15, role: "support" },
    ],
    upperLevelLabel: "Upper-level mixed-use program",
    operations: { edgeLabel: "North public and service arrival", itemLabel: "service bay", shelteredBandLabel: "Covered public entry", shelteredBandDepthFt: 20, outdoorZoneLabel: "Arrival / servicing / fire access", outdoorZoneDepthFt: 50 },
  },
  generic: {
    key: "generic",
    label: "Custom building",
    zones: [
      { id: "primary-program", name: "Primary program area", ratio: 0.6, role: "primary" },
      { id: "secondary-program", name: "Secondary program area", ratio: 0.22, role: "secondary" },
      { id: "circulation", name: "Circulation / shared area", ratio: 0.1, role: "secondary" },
      { id: "service-core", name: "Building services / core", ratio: 0.08, role: "support" },
    ],
    upperLevelLabel: "Upper-level program allowance",
    operations: { edgeLabel: "North primary arrival", itemLabel: "service bay", shelteredBandLabel: "Sheltered arrival / service edge", shelteredBandDepthFt: 18, outdoorZoneLabel: "Arrival / service and fire access", outdoorZoneDepthFt: 50 },
  },
};

export function detectBuildingTypology(buildingType: string): BuildingTypologyProfile {
  const value = buildingType.toLowerCase();
  if (/(warehouse|logistics|distribution|industrial|storage|factory|manufactur)/.test(value)) return profiles.logistics;
  if (/(hospital|health|clinic|medical|care centre|care center)/.test(value)) return profiles.healthcare;
  if (/(school|education|college|university|campus|academy)/.test(value)) return profiles.education;
  if (/(residential|apartment|housing|multifamily|multi-family|dwelling)/.test(value)) return profiles.residential;
  if (/(hotel|hospitality|resort|lodging)/.test(value)) return profiles.hotel;
  if (/(retail|shopping|store|supermarket|mall)/.test(value)) return profiles.retail;
  if (/(mixed.use|mixed use)/.test(value)) return profiles["mixed-use"];
  if (/(office|workplace|commercial)/.test(value)) return profiles.office;
  return profiles.generic;
}
