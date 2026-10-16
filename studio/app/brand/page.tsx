/**
 * @file /brand — the identity gallery.
 *
 * A route, not a registered asset: this is a review surface for judging the
 * packs, and registering it would imply it is part of the shipped product.
 */
import BrandGallery from "../../src/plugins/brand-gallery/BrandGallery";

export const dynamic = "force-dynamic";

/** Chrome (banner, nav, style root) is StudioShell's, mounted in the layout. */
export default function BrandPage() {
  return <BrandGallery />;
}
