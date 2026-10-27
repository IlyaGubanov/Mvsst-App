// =====================================================================
//  Раздел направления — пока заглушка: показывает карточку показателей направления.
//  Полные экраны (реестр, карточки объектов, ввод) появятся на шаге 6.
// =====================================================================

import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { useOverview } from '../api/overview.js';
import { directionUi } from '../directions.js';
import { todayIso } from '../utils/format.js';
import { Loading, ErrorBox } from '../components/Status.jsx';
import DirectionCard from './overview/DirectionCard.jsx';
import NotFoundPage from './NotFoundPage.jsx';

export default function DirectionPage() {
  const { direction, objectId } = useParams();
  const { user } = useAuth();
  const overview = useOverview(todayIso());

  // Направление должно быть в списке доступных (сервер всё равно проверит права при запросе данных)
  if (!user.directions.some((d) => d.code === direction)) return <NotFoundPage />;

  const ui = directionUi(direction);
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <ErrorBox error={overview.error} onRetry={overview.refetch} />;

  const dir = overview.data.directions.find((d) => d.code === direction);
  const kpi = dir?.kpi;
  const object = objectId && [...(kpi?.attention ?? []), ...(kpi?.remarks ?? [])].find((a) => String(a.id) === objectId);

  return (
    <div className="page soon">
      <div className="head">
        <div>
          <h1>{ui.name}</h1>
          <p className="lead">{object ? object.name : ui.about}</p>
        </div>
      </div>
      <div className="card">
        <p>
          {objectId
            ? <>Карточка объекта{object ? ` «${object.name}»` : ` № ${objectId}`} появится на следующем шаге. </>
            : <>Полный раздел направления — реестр объектов, графики, ввод данных — появится на следующем шаге. </>}
          <Link to="/">← Вернуться к сводке</Link>
        </p>
      </div>
      {dir && <div style={{ maxWidth: 620 }}><DirectionCard dir={dir} showOpen={false} /></div>}
    </div>
  );
}
