export type CommercialActionState = Readonly<{
  ok: boolean;
  message: string;
  errorCode?: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export const initialCommercialActionState: CommercialActionState = {
  ok: false,
  message: "",
};
