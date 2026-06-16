import { noop } from "lodash";
import { useEffect, useState } from "react";

type CORSImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src?: string;
}

export const CORSImage: React.FC<CORSImageProps> = ({ src, ...props }) => {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!src) {
      setObjectUrl(undefined);
      return;
    }

    let revoked = false;

    fetch(src, { mode: 'cors', cache: 'force-cache' })
      .then(async (r) => {
        if (!revoked) {
          setObjectUrl(URL.createObjectURL(await r.blob()));
        }
      })
      .catch(noop);

    return () => {
      revoked = true;
    };
  }, [src]);

  if (!objectUrl) return null;

  return <img src={objectUrl} {...props} />;
}
