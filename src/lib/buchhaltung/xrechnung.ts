import "server-only";
import { COMPANY } from "@/lib/company";
import { lineNetCents, unitCode } from "./money";
import type { DocData } from "./types";

// E-Rechnung im Format UN/CEFACT CII (Cross Industry Invoice) nach EN 16931.
// Dieselbe Struktur dient als XRechnung 3.0 (eigene XML-Datei) und als ZUGFeRD/Factur-X „EN 16931“ (eingebettet ins PDF).

export const GUIDELINE = {
  xrechnung: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
  zugferd: "urn:cen.eu:en16931:2017",
} as const;

const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const amt = (c: number) => (c / 100).toFixed(2);
const dec = (v: number, max = 4) => {
  const s = v.toFixed(max).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
};
const d102 = (ymd: string) => ymd.replace(/-/g, "");
const el = (tag: string, value: string | null | undefined, attrs = "") => (value === null || value === undefined || value === "" ? "" : `<${tag}${attrs}>${esc(value)}</${tag}>`);

function category(rate: number, reverseCharge: boolean) {
  if (reverseCharge) return "AE";
  return rate === 0 ? "Z" : "S";
}

export const REVERSE_CHARGE_TEXT = "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)";

function address(p: { street?: string | null; zip?: string | null; city?: string | null; country: string }) {
  return `<ram:PostalTradeAddress>${el("ram:PostcodeCode", p.zip)}${el("ram:LineOne", p.street)}${el("ram:CityName", p.city)}${el("ram:CountryID", p.country || "DE")}</ram:PostalTradeAddress>`;
}

/** CII-XML für Rechnung (380) oder Gutschrift/Storno (381). Angebote haben keine E-Rechnung. */
export function buildCii(d: DocData, profile: keyof typeof GUIDELINE): string {
  if (d.kind === "ANGEBOT") throw new Error("Für Angebote gibt es keine E-Rechnung.");
  if (!d.number) throw new Error("E-Rechnung erst nach dem Festschreiben.");
  const c = d.config;
  const typeCode = d.kind === "GUTSCHRIFT" ? "381" : "380";
  const b = d.buyer;

  const lines = d.lines
    .map((l, i) => {
      // Negative Positionen (z. B. Abzug): Menge negativ, Preis positiv (EN 16931 BR-27)
      const neg = l.price < 0;
      const qty = neg ? -l.qty : l.qty;
      const price = Math.abs(l.price);
      const net = price * (1 - l.discount / 100);
      const netPrice = Math.round(net * 10000) / 10000;
      const gross =
        l.discount > 0
          ? `<ram:GrossPriceProductTradePrice><ram:ChargeAmount>${dec(price)}</ram:ChargeAmount><ram:AppliedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${dec(price - netPrice)}</ram:ActualAmount><ram:Reason>Rabatt ${dec(l.discount, 2)} %</ram:Reason></ram:AppliedTradeAllowanceCharge></ram:GrossPriceProductTradePrice>`
          : "";
      const rate = d.reverseCharge ? 0 : l.taxRate;
      return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct>${el("ram:Name", l.name)}${el("ram:Description", l.description ?? null)}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement>${gross}<ram:NetPriceProductTradePrice><ram:ChargeAmount>${dec(netPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unit)}">${dec(qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category(rate, d.reverseCharge)}</ram:CategoryCode><ram:RateApplicablePercent>${dec(rate, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(lineNetCents(l))}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("\n");

  const taxes = d.totals.taxes
    .map((t) => {
      const cat = category(t.rate, d.reverseCharge);
      const reason = cat === "AE" ? `<ram:ExemptionReason>${esc(REVERSE_CHARGE_TEXT)}</ram:ExemptionReason>` : "";
      const reasonCode = cat === "AE" ? "<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>" : "";
      return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(t.taxCents)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${reason}<ram:BasisAmount>${amt(t.netCents)}</ram:BasisAmount><ram:CategoryCode>${cat}</ram:CategoryCode>${reasonCode}<ram:RateApplicablePercent>${dec(t.rate, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
    })
    .join("");

  const from = d.serviceFrom ?? d.date;
  const to = d.serviceTo ?? from;
  const delivery = `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(to)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`;
  const period = from !== to ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">${d102(from)}</udt:DateTimeString></ram:StartDateTime><ram:EndDateTime><udt:DateTimeString format="102">${d102(to)}</udt:DateTimeString></ram:EndDateTime></ram:BillingSpecifiedPeriod>` : "";

  const terms =
    d.kind === "RECHNUNG"
      ? `<ram:SpecifiedTradePaymentTerms><ram:Description>${esc(d.dueDate ? `Zahlbar ohne Abzug bis ${d.dueDate.split("-").reverse().join(".")}` : "Zahlbar sofort ohne Abzug")}</ram:Description>${d.dueDate ? `<ram:DueDateDateTime><udt:DateTimeString format="102">${d102(d.dueDate)}</udt:DateTimeString></ram:DueDateDateTime>` : ""}</ram:SpecifiedTradePaymentTerms>`
      : `<ram:SpecifiedTradePaymentTerms><ram:Description>Gutschrift – der Betrag wird verrechnet bzw. erstattet.</ram:Description></ram:SpecifiedTradePaymentTerms>`;

  const notes = [d.reverseCharge ? REVERSE_CHARGE_TEXT : null, d.title ?? null].filter(Boolean) as string[];
  const buyerRef = b.buyerReference || (b.customerNo ? String(b.customerNo) : b.name).slice(0, 100);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINE[profile]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${esc(d.number)}</ram:ID>
<ram:TypeCode>${typeCode}</ram:TypeCode>
<ram:IssueDateTime><udt:DateTimeString format="102">${d102(d.date)}</udt:DateTimeString></ram:IssueDateTime>
${notes.map((n) => `<ram:IncludedNote><ram:Content>${esc(n)}</ram:Content></ram:IncludedNote>`).join("")}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lines}
<ram:ApplicableHeaderTradeAgreement>
<ram:BuyerReference>${esc(buyerRef)}</ram:BuyerReference>
<ram:SellerTradeParty>
<ram:Name>${esc(COMPANY.name)}</ram:Name>
<ram:SpecifiedLegalOrganization><ram:ID>${esc(COMPANY.register.replace(/^Amtsgericht\s+/, ""))}</ram:ID></ram:SpecifiedLegalOrganization>
<ram:DefinedTradeContact><ram:PersonName>${esc(c.contactName || "Buchhaltung")}</ram:PersonName><ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(COMPANY.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication><ram:URIID>${esc(COMPANY.email)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>
${address({ street: COMPANY.street, zip: COMPANY.zip, city: COMPANY.city, country: "DE" })}
<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(COMPANY.email)}</ram:URIID></ram:URIUniversalCommunication>
<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(COMPANY.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>${c.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(c.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
</ram:SellerTradeParty>
<ram:BuyerTradeParty>
${el("ram:ID", b.customerNo ? String(b.customerNo) : null)}<ram:Name>${esc(b.name)}</ram:Name>
${b.contactName ? `<ram:DefinedTradeContact><ram:PersonName>${esc(b.contactName)}</ram:PersonName></ram:DefinedTradeContact>` : ""}
${address(b)}
${b.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(b.email)}</ram:URIID></ram:URIUniversalCommunication>` : ""}
${b.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(b.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
</ram:BuyerTradeParty>
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${delivery}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:PaymentReference>${esc(d.number)}</ram:PaymentReference>
<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:Information>SEPA-Überweisung</ram:Information><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(c.iban)}</ram:IBANID><ram:AccountName>${esc(COMPANY.name)}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>${c.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(c.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ""}</ram:SpecifiedTradeSettlementPaymentMeans>
${taxes}
${period}
${terms}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${amt(d.totals.netCents)}</ram:LineTotalAmount>
<ram:ChargeTotalAmount>0.00</ram:ChargeTotalAmount>
<ram:AllowanceTotalAmount>0.00</ram:AllowanceTotalAmount>
<ram:TaxBasisTotalAmount>${amt(d.totals.netCents)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="EUR">${amt(d.totals.taxCents)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${amt(d.totals.grossCents)}</ram:GrandTotalAmount>
<ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount>
<ram:DuePayableAmount>${amt(d.totals.grossCents)}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${d.preceding ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(d.preceding.number)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(d.preceding.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ""}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/** Was fehlt für eine gültige XRechnung (öffentliche Auftraggeber)? */
export function xrechnungGaps(d: Pick<DocData, "buyer" | "reverseCharge">) {
  const g: string[] = [];
  if (!d.buyer.email) g.push("E-Mail-Adresse des Kunden");
  if (!d.buyer.street || !d.buyer.zip || !d.buyer.city) g.push("vollständige Anschrift des Kunden");
  if (d.reverseCharge && !d.buyer.vatId) g.push("USt-IdNr. des Kunden (§ 13b)");
  return g;
}
