import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { demoHref, isDemoHref, useRouter, type DemoHref } from "./navigation";

type DemoLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: DemoHref;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
};

const Link = forwardRef<HTMLAnchorElement, DemoLinkProps>(function Link(
  { href, replace = false, scroll = true, prefetch: _prefetch, onClick, target, ...props },
  ref,
) {
  // There is no Next server in this optional static build.
  void _prefetch;
  const router = useRouter();
  const resolvedHref = demoHref(href);
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (target && target !== "_self") || props.download != null) return;
    if (!isDemoHref(resolvedHref)) return;
    event.preventDefault();
    if (replace) router.replace(resolvedHref, { scroll });
    else router.push(resolvedHref, { scroll });
  }
  return <a {...props} ref={ref} href={resolvedHref} target={target} onClick={handleClick} />;
});

export default Link;
