// Ausschnitte der Lexware-Datenstrukturen (nur genutzte Felder)

export type LexPage<T> = { content: T[]; totalPages: number; totalElements: number; number: number; size: number; first: boolean; last: boolean };

export type LexContact = {
  id: string;
  version: number;
  roles: { customer?: { number?: number }; vendor?: { number?: number } };
  company?: { name: string; taxNumber?: string; vatRegistrationId?: string; contactPersons?: { salutation?: string; firstName?: string; lastName?: string; emailAddress?: string; phoneNumber?: string; primary?: boolean }[] };
  person?: { salutation?: string; firstName?: string; lastName: string };
  addresses?: { billing?: LexAddress[]; shipping?: LexAddress[] };
  emailAddresses?: Record<string, string[]>;
  phoneNumbers?: Record<string, string[]>;
  note?: string;
  archived?: boolean;
};

export type LexAddress = { supplement?: string; street?: string; zip?: string; city?: string; countryCode: string };

export type LexVoucherListItem = {
  id: string;
  voucherType: string;
  voucherStatus: string;
  voucherNumber?: string;
  voucherDate?: string;
  createdDate?: string;
  updatedDate?: string;
  dueDate?: string | null;
  contactId?: string | null;
  contactName?: string;
  totalAmount?: number;
  openAmount?: number;
  currency?: string;
  archived?: boolean;
};

export type LexLineItem = {
  id?: string;
  type: "custom" | "material" | "service" | "text";
  name: string;
  description?: string;
  quantity?: number;
  unitName?: string;
  unitPrice?: { currency: "EUR"; netAmount?: number; grossAmount?: number; taxRatePercentage: number };
  discountPercentage?: number;
  lineItemAmount?: number;
};

export type LexVoucher = {
  id: string;
  voucherNumber?: string;
  voucherDate?: string;
  voucherStatus?: string;
  expirationDate?: string;
  dueDate?: string;
  title?: string;
  introduction?: string;
  remark?: string;
  address?: { contactId?: string; name?: string; street?: string; zip?: string; city?: string; countryCode?: string };
  lineItems?: LexLineItem[];
  totalPrice?: { currency: string; totalNetAmount?: number; totalGrossAmount?: number; totalTaxAmount?: number };
  paymentConditions?: { paymentTermLabel?: string; paymentTermDuration?: number };
};

export type LexPayment = {
  openAmount?: number;
  paymentStatus?: string;
  currency?: string;
  voucherType?: string;
  voucherStatus?: string;
  paidDate?: string;
  paymentItems?: { paymentItemType?: string; postingDate?: string; amount?: number; currency?: string }[];
};

export type LexProfile = { organizationId: string; companyName: string; created?: { userName?: string; userEmail?: string }; taxType?: string; smallBusiness?: boolean };

export type LexArticle = { id: string; title: string; description?: string; type: "PRODUCT" | "SERVICE"; articleNumber?: string; unitName?: string; price?: { netPrice?: number; grossPrice?: number; leadingPrice?: string; taxRate?: number } };

export type LexCreated = { id: string; resourceUri: string; createdDate: string; updatedDate: string; version: number };
