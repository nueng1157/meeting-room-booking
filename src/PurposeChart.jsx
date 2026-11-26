import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

export default function PurposeChart({ items }) {
  return <div className="purpose-chart" role="img" aria-label="กราฟจำนวนการจองตามวัตถุประสงค์">
            <BarChart responsive width="100%" height={Math.max(240, items.length * 48)}
              data={items} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#e8edf6" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: '#52627c', fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={119} tick={{ fill: '#384863', fontSize: 12 }}
                tickLine={false} axisLine={false} interval={0} />
              <Tooltip formatter={(value) => [value + ' รายการ', 'จำนวนการจอง']} />
              <Bar dataKey="count" name="จำนวนการจอง" fill="#4f50c9" radius={[0, 5, 5, 0]} barSize={19} />
            </BarChart>
            <ul className="sr-only">{items.map((item) => <li key={item.name}>{item.name} {item.count} รายการ</li>)}</ul>
          </div>;
}
