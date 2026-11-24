import logo from '../../assets/logo.svg?inline';

/** The CypherSuraksha logo (one asset, src/assets/logo.svg) for the on-page toasts, badge, pill and warning. */
export const Mark = ({ class: cls = 'cs-mark' }: { class?: string }) => <img class={cls} src={logo} alt="" width="22" height="22" />;
